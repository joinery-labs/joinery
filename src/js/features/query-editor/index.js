/**
 * Query Editor - Main Entry Point
 * 
 * Orchestrates the initialization and interaction of query editor modules.
 * Wires together the tab manager, editor factory, history manager, and event bus.
 */

import { APP_STATE } from '../../main.js';
import { $ } from '../../utils/dom.js';
import { on, Events } from '../../core/event-bus.js';
import { createQueryTab, removeQueryTab, initTabDragDrop } from './tab-manager.js';
import { createEditor, destroyEditor } from './editor-factory.js';
import { loadHistory, cleanupHistoryTreeSelect } from './history-manager.js';
import { setupTabHandlers, runQuery, getQuerySelectHandler, saveQueryFromTab } from './tab-controller.js';
import { fetchDuckDbSchema } from './schema-provider.js';
import { invalidateSchemaCache } from '../../editor/sql-intellisense.js';
import { cleanupInlineQueryTracking } from '../results/index.js';

// ============================================================================
// TAB REGISTRY - Tracks active tabs to facilitate cross-tab state synchronization
// ============================================================================

/** @type {Map<number, Function>} Registry of active tabs and their query selection callbacks. */
const tabRegistry = new Map();

/**
 * Register a tab for receiving saved queries updates
 * @param {number} tabId - Tab ID
 * @param {Function} onSelect - Query select callback
 */
export function registerTab(tabId, onSelect) {
    tabRegistry.set(tabId, onSelect);
}

/**
 * Unregister a tab when it's closed
 * @param {number} tabId - Tab ID
 */
export function unregisterTab(tabId) {
    tabRegistry.delete(tabId);
}

// Event Listener: Refreshes all query history trees when the saved queries list changes
on(Events.QUERIES_CHANGED, async () => {
    // Refresh all registered tabs
    for (const [tabId, onSelect] of tabRegistry) {
        // Check if tab still exists in DOM (now uses TreeSelect container)
        const historyContainer = $(`#history-treeselect-${tabId}`);
        if (historyContainer) {
            await loadHistory(tabId, onSelect);
        } else {
            // Tab was removed but not unregistered - clean up
            tabRegistry.delete(tabId);
        }
    }
});

// Event Listener: Invalidates schema cache when the database connection changes
on(Events.DATABASE_SWITCHED, () => {
    invalidateSchemaCache();
});

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Initialize query editor system
 */
export function initQueryEditor() {
    // Add tab button click handler
    $("#addTab").addEventListener("click", (e) => {
        e.preventDefault();
        addQueryTab();
    });

    // Tab close handler - passed to initTabDragDrop for event delegation
    const handleTabClose = (tabId) => {
        // Unregister tab from cross-tab sync
        unregisterTab(tabId);

        // Cleanup TreeSelect instance
        cleanupHistoryTreeSelect(tabId);

        // Cleanup inline query tracking map
        cleanupInlineQueryTracking(tabId);

        removeQueryTab(
            tabId,
            destroyEditor,
            (el) => el.cleanup?.()
        );
    };

    // Initialize drag & drop for tabs with close handler
    initTabDragDrop(handleTabClose);
}

/**
 * Add a new query tab
 * @param {string} prefillText - Initial SQL text
 * @returns {number} New tab ID
 */
export function addQueryTab(prefillText = "", title = null) {
    const id = ++APP_STATE.tabCounter;
    const defaultTitle = title || `Tab-${id}`;

    // Create tab UI
    createQueryTab(id, defaultTitle);

    // Create editor
    const wrapId = `sql-editor-wrap-${id}`;
    const editorId = `sql-editor-${id}`;

    // Get the query select handler for this tab
    const onQuerySelect = getQuerySelectHandler(id);

    // Register this tab for cross-tab sync of saved queries
    registerTab(id, onQuerySelect);

    createEditor(wrapId, editorId, id, prefillText, fetchDuckDbSchema, {
        runButtonId: `run-query-${id}`,
        onSave: () => saveQueryFromTab(id)
    }, async (editor, isFallback) => {
        // Load history after editor is ready
        await loadHistory(id, onQuerySelect);

        // Auto-focus the editor
        if (editor && !isFallback) {
            editor.focus();
        } else if (isFallback) {
            const textarea = document.getElementById(`sql-query-${id}`);
            if (textarea) textarea.focus();
        }
    });

    // Setup toolbar button handlers
    setupTabHandlers(id);

    return id;
}
