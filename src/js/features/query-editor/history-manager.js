/**
 * History Manager
 * 
 * Manages the persistence and retrieval of saved queries.
 * Interfaces with the platform storage to ensure cross-platform availability of user queries.
 */

import { $ } from '../../utils/dom.js';
import { canonicalizeStatement } from '../../utils/sql.js';
import { emit, Events } from '../../core/event-bus.js';
import {
    getSavedQueries,
    setSavedQueries,
    addSavedQuery
} from '../../platform/index.js';
import {
    buildParametersFromSql
} from '../../utils/parameters.js';
import { TreeSelect } from '../../ui/treeselect.js';

// Registry of TreeSelect instances keyed by tab ID, used for proper cleanup
const treeSelectInstances = new Map();

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Build hierarchical tree structure from flat queries for TreeSelect
 * @param {Array} queries - Flat array of query objects with folder property
 * @returns {Array} TreeSelect-compatible hierarchical data
 */
export function buildQueryHierarchy(queries) {
    if (!queries || !queries.length) return [];

    // Group queries by folder path
    const folderMap = new Map();

    for (const query of queries) {
        const folder = query.folder || '/';
        if (!folderMap.has(folder)) {
            folderMap.set(folder, []);
        }
        folderMap.get(folder).push(query);
    }

    // Sort folder paths alphabetically
    const sortedFolders = [...folderMap.keys()].sort((a, b) => a.localeCompare(b));

    // Build tree structure
    const root = [];
    const folderNodes = new Map(); // Cache created folder nodes to avoid duplicates

    for (const folderPath of sortedFolders) {
        const queriesInFolder = folderMap.get(folderPath);
        // Sort queries within folder by name
        queriesInFolder.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        if (folderPath === '/') {
            // Root level queries
            for (const query of queriesInFolder) {
                root.push({
                    id: query.id,
                    label: query.name || query.title,
                    query: query // Store full query for retrieval
                });
            }
        } else {
            // Parse folder path and create nested structure
            const parts = folderPath.split('/').filter(Boolean);
            let currentLevel = root;
            let currentPath = '';

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                currentPath = currentPath + '/' + part;

                // Find or create folder node
                let folderNode = folderNodes.get(currentPath);
                if (!folderNode) {
                    folderNode = {
                        id: `folder:${currentPath}`,
                        label: part,
                        children: [],
                        isFolder: true,
                        disabled: true // Folder nodes are structural only, not selectable
                    };
                    folderNodes.set(currentPath, folderNode);
                    currentLevel.push(folderNode);
                }
                currentLevel = folderNode.children;
            }

            // Add queries to the deepest folder
            for (const query of queriesInFolder) {
                currentLevel.push({
                    id: query.id,
                    label: query.name || query.title,
                    query: query
                });
            }
        }
    }

    // Sort root level: folders first (alphabetically), then queries (alphabetically)
    root.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return (a.label || '').localeCompare(b.label || '');
    });

    // Recursively sort children in folder nodes
    const sortChildren = (nodes) => {
        for (const node of nodes) {
            if (node.children) {
                node.children.sort((a, b) => {
                    if (a.isFolder && !b.isFolder) return -1;
                    if (!a.isFolder && b.isFolder) return 1;
                    return (a.label || '').localeCompare(b.label || '');
                });
                sortChildren(node.children);
            }
        }
    };
    sortChildren(root);

    return root;
}

/**
 * Load saved queries into TreeSelect
 * @param {number} tabId - Tab ID
 * @param {function} onSelect - Callback when query is selected: (query) => void
 *                              Receives full query object including parameters
 */
export async function loadHistory(tabId, onSelect) {
    const container = $(`#history-treeselect-${tabId}`);
    if (!container) return;

    const items = await getSavedQueries();

    // Destroy existing TreeSelect instance if any
    if (treeSelectInstances.has(tabId)) {
        treeSelectInstances.get(tabId).destroy();
        treeSelectInstances.delete(tabId);
    }

    // Build hierarchical data
    const treeData = buildQueryHierarchy(items);

    // Create TreeSelect instance
    const treeSelect = new TreeSelect(container, {
        data: treeData,
        multiple: false,
        searchable: true,
        clearable: true,
        placeholder: items.length ? '(select saved query)' : '(no saved queries)',
        noOptionsText: 'No saved queries',
        noResultsText: 'No matching queries',
        closeOnSelect: true,
        flat: false, // Use hierarchy mode
        valueConsistsOf: 'LEAF', // Only allow selecting leaf nodes (queries, not folders)
        icon: 'bi bi-bookmark-check',
        expandAll: true // Always expand folder nodes by default
    });

    // Handle usage of selected query; retrieves full query object from source data
    // Note: For single-select configuration, getValue() returns a single ID string
    treeSelect.on('change', (value) => {
        // For single-select, value is a single ID (or null), not an array
        if (value === null || value === undefined) return;

        const selectedId = value;

        // Skip folder selections (shouldn't happen since disabled, but safety check)
        if (typeof selectedId === 'string' && selectedId.startsWith('folder:')) {
            treeSelect.clear();
            return;
        }

        // Find the query object from original items array
        const query = items.find(q => q.id === selectedId);
        if (query && onSelect) {
            onSelect(query);
        }

        // Clear selection after use so same query can be selected again
        setTimeout(() => treeSelect.clear(), 100);
    });

    treeSelectInstances.set(tabId, treeSelect);
}

/**
 * Cleanup TreeSelect instance for a tab
 * @param {number} tabId - Tab ID
 */
export function cleanupHistoryTreeSelect(tabId) {
    if (treeSelectInstances.has(tabId)) {
        treeSelectInstances.get(tabId).destroy();
        treeSelectInstances.delete(tabId);
    }
}

/**
 * Get TreeSelect instance for a tab (for enabling/disabling during execution)
 * @param {number} tabId - Tab ID
 * @returns {TreeSelect|null}
 */
export function getHistoryTreeSelect(tabId) {
    return treeSelectInstances.get(tabId) || null;
}

/**
 * Save queries to storage
 * @param {string} rawSql - Raw SQL text
 * @param {boolean} splitMode - Whether to split into multiple queries
 * @param {Array<{sql: string, name: string, parameters?: Array}>} queries - Array of queries to save
 * @returns {Promise<object>} Result with saved/skipped counts
 */
export async function saveQueries(rawSql, splitMode, queries) {
    const items = await getSavedQueries();
    const existingSqlSet = new Set(items.map(i => i.sql));
    const existingNameSet = new Set(
        items
            .map(i => (i.name || i.title || '').trim().toLowerCase())
            .filter(Boolean)
    );
    const batchNameSet = new Set();

    let saved = 0, skipped = 0;
    const errors = [];

    for (const queryData of queries) {
        const rawQuerySql = queryData.sql;
        const name = queryData.name;
        const parameters = queryData.parameters || [];

        const sql = splitMode ? canonicalizeStatement(rawQuerySql.trim()) : rawQuerySql.trim();
        const trimmedName = name.trim();

        if (!sql) {
            errors.push('Query cannot be empty');
            continue;
        }

        if (!trimmedName) {
            errors.push('All queries must have a name');
            continue;
        }

        const nameKey = trimmedName.toLowerCase();
        if (existingNameSet.has(nameKey) || batchNameSet.has(nameKey)) {
            errors.push(`Query name "${trimmedName}" already exists`);
            continue;
        }
        batchNameSet.add(nameKey);

        if (existingSqlSet.has(sql)) {
            skipped++;
            continue;
        }

        // Add query using the new store API
        const result = await addSavedQuery({
            name: trimmedName,
            sql: sql,
            parameters: parameters,
            folder: queryData.folder || '/'
        });

        if (result.success) {
            existingSqlSet.add(sql);
            saved++;
        } else {
            errors.push(result.error || 'Failed to save query');
        }
    }

    if (errors.length > 0) {
        return { success: false, error: errors[0] };
    }

    if (saved === 0 && skipped === 0) {
        return { success: false, error: 'Nothing to save' };
    }

    // Emit event to notify all subscribers that queries changed
    emit(Events.QUERIES_CHANGED);

    return {
        success: true,
        saved,
        skipped,
        error: null
    };
}

/**
 * Update existing queries in storage
 * @param {Array<{id?: string, sql: string, name: string, parameters?: Array, ts?: number}>} updatedItems - Updated queries
 * @returns {Promise<object>} Result with success flag
 */
export async function updateQueries(updatedItems) {
    const errors = [];
    const sqlSet = new Set();
    const nameSet = new Set();

    // Validate all items first
    for (const item of updatedItems) {
        const sql = canonicalizeStatement(item.sql.trim());
        const name = item.name.trim();

        if (!sql) {
            errors.push('Query cannot be empty');
            continue;
        }

        if (!name) {
            errors.push('All queries must have a name');
            continue;
        }

        const nameKey = name.toLowerCase();
        if (nameSet.has(nameKey)) {
            errors.push('Duplicate query names are not allowed');
            continue;
        }
        nameSet.add(nameKey);

        if (sqlSet.has(sql)) {
            errors.push('Duplicate queries are not allowed');
            continue;
        }
        sqlSet.add(sql);
    }

    if (errors.length > 0) {
        return { success: false, error: errors[0] };
    }

    // Rebuild parameters for each item based on current SQL
    const processedItems = updatedItems.map(item => ({
        id: item.id,
        name: item.name.trim(),
        sql: item.sql.trim(),
        parameters: buildParametersFromSql(item.sql, item.parameters || []),
        folder: item.folder || '/',
        ts: item.ts || Date.now()
    }));

    const ok = await setSavedQueries(processedItems);

    // Emit event to notify all subscribers that queries changed
    if (ok) {
        emit(Events.QUERIES_CHANGED);
    }

    return {
        success: ok,
        error: ok ? null : 'Storage not available'
    };
}

/**
 * Get all saved queries
 * @returns {Promise<Array>} Array of saved query objects
 */
export async function getQueries() {
    return await getSavedQueries();
}

