/**
 * Schema Browser
 * 
 * UI component that displays database schema in a tree view within query tabs.
 * Each tab has its own schema browser instance but shares the centralized schema cache.
 */

import { $, escapeHTML } from '../../utils/dom.js';
import { getSchemaData, subscribeToSchemaChanges } from '../../core/schema-cache.js';

// ============================================================================
// Private State
// ============================================================================

/** @type {Map<number, object>} Browser state per tab (unsubscribe function, resize state, etc.) */
const browserStates = new Map();

/** Default pane width in pixels */
const DEFAULT_PANE_WIDTH = 250;

/** Minimum pane width */
const MIN_PANE_WIDTH = 180;

/** Maximum pane width */
const MAX_PANE_WIDTH = 500;

/** Mobile breakpoint width for default visibility (matches CSS) */
const MOBILE_BREAKPOINT = 576;

// ============================================================================
// Tree View Rendering
// ============================================================================

/**
 * Create icon for node type
 * @param {string} type - 'schema', 'table', 'view', or 'column'
 * @returns {string} HTML for icon
 */
function getNodeIcon(type) {
    switch (type) {
        case 'schema':
            return '<i class="bi bi-folder schema-icon"></i>';
        case 'table':
            return '<i class="bi bi-table table-icon"></i>';
        case 'view':
            return '<i class="bi bi-eye view-icon"></i>';
        case 'column':
            return '<i class="bi bi-columns-gap column-icon"></i>';
        default:
            return '<i class="bi bi-dot"></i>';
    }
}

/**
 * Render a column node
 * @param {object} column - Column data
 * @returns {string} HTML
 */
function renderColumn(column) {
    return `
        <div class="schema-tree-node schema-tree-column" title="${escapeHTML(column.name)}: ${escapeHTML(column.type)}">
            <span class="expand-icon"></span>
            ${getNodeIcon('column')}
            <span class="node-name">${escapeHTML(column.name)}</span>
            <span class="node-type">${escapeHTML(column.type)}</span>
        </div>
    `;
}

/**
 * Render a table node with columns
 * @param {object} table - Table data
 * @param {string} schemaName - Parent schema name
 * @returns {string} HTML
 */
function renderTable(table, schemaName) {
    const columns = table.columns || [];
    const hasColumns = columns.length > 0;
    const nodeType = table.type === 'view' ? 'view' : 'table';

    return `
        <div class="schema-tree-item" data-table="${escapeHTML(schemaName)}.${escapeHTML(table.name)}">
            <div class="schema-tree-node schema-tree-table ${hasColumns ? 'has-children' : ''}" data-expanded="false">
                <span class="expand-icon">${hasColumns ? '<i class="bi bi-chevron-right"></i>' : ''}</span>
                ${getNodeIcon(nodeType)}
                <span class="node-name">${escapeHTML(table.name)}</span>
                <span class="node-count">${columns.length}</span>
            </div>
            <div class="schema-tree-children" style="display: none;">
                ${columns.map(col => renderColumn(col)).join('')}
            </div>
        </div>
    `;
}

/**
 * Render a schema node with tables
 * @param {object} schema - Schema data
 * @returns {string} HTML
 */
function renderSchema(schema) {
    const tables = schema.tables || [];
    const hasTables = tables.length > 0;

    return `
        <div class="schema-tree-item" data-schema="${escapeHTML(schema.name)}">
            <div class="schema-tree-node schema-tree-schema ${hasTables ? 'has-children' : ''}" data-expanded="true">
                <span class="expand-icon">${hasTables ? '<i class="bi bi-chevron-down"></i>' : ''}</span>
                ${getNodeIcon('schema')}
                <span class="node-name">${escapeHTML(schema.name)}</span>
                <span class="node-count">${tables.length}</span>
            </div>
            <div class="schema-tree-children">
                ${tables.map(table => renderTable(table, schema.name)).join('')}
            </div>
        </div>
    `;
}

/**
 * Render the full schema tree
 * @param {object} data - Schema data from cache
 * @returns {string} HTML
 */
function renderSchemaTree(data) {
    if (!data || !data.schemas || data.schemas.length === 0) {
        return `
            <div class="schema-tree-empty">
                <i class="bi bi-database-slash"></i>
                <span>No schemas found</span>
            </div>
        `;
    }

    return data.schemas.map(schema => renderSchema(schema)).join('');
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle tree node click for expand/collapse
 * @param {Event} e - Click event
 */
function handleTreeNodeClick(e) {
    const node = e.target.closest('.schema-tree-node.has-children');
    if (!node) return;

    const item = node.closest('.schema-tree-item');
    const children = item.querySelector(':scope > .schema-tree-children');
    const expandIcon = node.querySelector('.expand-icon i');

    if (!children || !expandIcon) return;

    const isExpanded = node.dataset.expanded === 'true';

    if (isExpanded) {
        children.style.display = 'none';
        node.dataset.expanded = 'false';
        expandIcon.className = 'bi bi-chevron-right';
    } else {
        children.style.display = 'block';
        node.dataset.expanded = 'true';
        expandIcon.className = 'bi bi-chevron-down';
    }
}

/** Movement threshold to distinguish click from drag (in pixels) */
const DRAG_THRESHOLD = 5;

/**
 * Toggle schema browser pane open/closed
 * @param {number} tabId - Tab ID
 */
function toggleSchemaBrowser(tabId) {
    const pane = $(`#schema-browser-${tabId}`);
    if (!pane) return;

    const state = browserStates.get(tabId);
    if (!state) return;

    const isCollapsed = pane.classList.contains('collapsed');

    if (isCollapsed) {
        // Open: restore saved width
        pane.classList.remove('collapsed');
        pane.style.width = `${state.savedWidth || DEFAULT_PANE_WIDTH}px`;
    } else {
        // Close: save current width and collapse
        state.savedWidth = pane.offsetWidth;
        pane.classList.add('collapsed');
    }
}

/**
 * Setup resize drag handling with toggle support
 * @param {number} tabId - Tab ID
 */
function setupResizer(tabId) {
    const resizer = $(`#schema-resizer-${tabId}`);
    const pane = $(`#schema-browser-${tabId}`);

    if (!resizer || !pane) return { cleanup: () => { } };

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    let hasMoved = false;

    const onMouseMove = (e) => {
        if (!isResizing) return;

        const delta = e.clientX - startX;

        // Check if we've moved beyond threshold (actual drag)
        if (Math.abs(delta) > DRAG_THRESHOLD) {
            hasMoved = true;
        }

        if (hasMoved) {
            // If pane is collapsed and user starts dragging, expand it first
            if (pane.classList.contains('collapsed')) {
                pane.classList.remove('collapsed');
            }
            const newWidth = Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, startWidth + delta));
            pane.style.width = `${newWidth}px`;
        }
    };

    const onMouseUp = () => {
        if (!isResizing) return;

        // If no significant movement, treat as click (toggle)
        if (!hasMoved) {
            toggleSchemaBrowser(tabId);
        }

        isResizing = false;
        hasMoved = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    const onMouseDown = (e) => {
        // Only initiate resize/toggle from the resizer area
        isResizing = true;
        hasMoved = false;
        startX = e.clientX;
        startWidth = pane.classList.contains('collapsed') ? DEFAULT_PANE_WIDTH : pane.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    resizer.addEventListener('mousedown', onMouseDown);

    return {
        cleanup: () => {
            resizer.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
    };
}

/**
 * Setup height synchronization between schema browser and query-tab-main
 * Uses ResizeObserver to keep heights in sync as editor resizes
 * @param {number} tabId - Tab ID
 * @returns {object} Object with cleanup function
 */
function setupHeightSync(tabId) {
    const pane = $(`#schema-browser-${tabId}`);
    const layout = pane?.closest('.query-tab-layout');
    const main = layout?.querySelector('.query-tab-main');

    if (!pane || !main) return { cleanup: () => { } };

    const syncHeight = () => {
        const mainHeight = main.offsetHeight;
        pane.style.height = `${mainHeight}px`;
    };

    // Initial sync
    syncHeight();

    // Watch for main area resize (e.g., editor resize)
    const resizeObserver = new ResizeObserver(syncHeight);
    resizeObserver.observe(main);

    return {
        cleanup: () => {
            resizeObserver.disconnect();
            pane.style.height = '';
        }
    };
}


// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Initialize schema browser for a tab
 * @param {number} tabId - Tab ID
 */
export async function initSchemaBrowser(tabId) {
    // Cleanup existing state to prevent memory leaks
    if (browserStates.has(tabId)) {
        destroySchemaBrowser(tabId);
    }

    const container = $(`#schema-browser-${tabId}`);
    if (!container) return;

    // Show loading state
    const treeContainer = container.querySelector('.schema-tree-content');
    if (treeContainer) {
        treeContainer.innerHTML = '<div class="schema-tree-loading"><div class="spinner-border spinner-border-sm"></div> Loading...</div>';
    }

    // Subscribe to schema changes
    const unsubscribe = subscribeToSchemaChanges(async () => {
        try {
            await refreshSchemaBrowser(tabId);
        } catch (err) {
            console.error('[SchemaBrowser] Error refreshing:', err);
        }
    });

    // Setup click handler for tree nodes
    const treeClickHandler = (e) => handleTreeNodeClick(e);
    container.addEventListener('click', treeClickHandler);

    // Setup resizer
    const resizerState = setupResizer(tabId);

    // Setup height synchronization with query-tab-main
    const heightSyncState = setupHeightSync(tabId);

    // Store state for cleanup
    browserStates.set(tabId, {
        unsubscribe,
        container,
        treeClickHandler,
        resizerCleanup: resizerState.cleanup,
        heightSyncCleanup: heightSyncState.cleanup
    });

    // Load data
    await refreshSchemaBrowser(tabId);
}

/**
 * Refresh schema browser content
 * @param {number} tabId - Tab ID
 */
export async function refreshSchemaBrowser(tabId) {
    const container = $(`#schema-browser-${tabId}`);
    if (!container) return;

    const treeContainer = container.querySelector('.schema-tree-content');
    if (!treeContainer) return;

    try {
        const data = await getSchemaData();
        treeContainer.innerHTML = renderSchemaTree(data);
    } catch (err) {
        console.error('Error loading schema:', err);
        treeContainer.innerHTML = `
            <div class="schema-tree-error">
                <i class="bi bi-exclamation-triangle"></i>
                <span>Failed to load schema</span>
            </div>
        `;
    }
}

/**
 * Cleanup schema browser for a tab
 * @param {number} tabId - Tab ID
 */
export function destroySchemaBrowser(tabId) {
    const state = browserStates.get(tabId);
    if (state) {
        state.unsubscribe?.();

        if (state.container && state.treeClickHandler) {
            state.container.removeEventListener('click', state.treeClickHandler);
        }

        state.resizerCleanup?.();
        state.heightSyncCleanup?.();
        browserStates.delete(tabId);
    }
}

/**
 * Get HTML template for schema browser pane
 * @param {number} tabId - Tab ID
 * @returns {string} HTML
 */
export function getSchemaBrowserHTML(tabId) {
    // Check for mobile device to default to collapsed state
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT;
    const collapsedClass = isMobile ? ' collapsed' : '';

    return `
        <div class="schema-browser-pane${collapsedClass}" id="schema-browser-${tabId}" style="width: ${DEFAULT_PANE_WIDTH}px;">
            <div class="schema-browser-header">
                <span class="schema-browser-title">
                    <i class="bi bi-diagram-3"></i>
                    Schema
                </span>
            </div>
            <div class="schema-tree-content"></div>
        </div>
        <div class="schema-browser-resizer" id="schema-resizer-${tabId}">
            <span class="schema-resizer-grip" title="Click to toggle and drag to resize the schema browser">
                <i class="bi bi-grip-vertical"></i>
            </span>
        </div>
    `;
}
