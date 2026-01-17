/**
 * Query Tab Controller
 * 
 * Coordinations user interactions within a query tab.
 * Manages toolbar actions, query execution flows, and loading states.
 */

import { $ } from '../../utils/dom.js';
import { notify, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { getEditor, getSqlFromEditor } from './editor-factory.js';
import { runQueryInTab as executeQuery } from './query-executor.js';
import { loadHistory, saveQueries, updateQueries, getQueries, getHistoryTreeSelect } from './history-manager.js';
import { showSaveQueriesModal, showManageQueriesModal } from './modal-handlers.js';
import { showParameterInputModal, queryNeedsParameters } from './parameter-modal.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Setup event handlers for a query tab's toolbar buttons
 * @param {number} tabId - Tab ID
 */
export function setupTabHandlers(tabId) {
    // Run query button
    $(`#run-query-${tabId}`).addEventListener("click", () => runQuery(tabId));

    // Save query button
    $(`#save-query-${tabId}`).addEventListener("click", () => saveQueryFromTab(tabId));

    // Manage history button
    $(`#manage-history-${tabId}`).addEventListener("click", () => handleManageQueries(tabId));
}

/**
 * Toggles the loading overlay and disables input controls for a specific tab during query execution.
 * Applied during both main tab execution and inline result execution.
 * @param {number} tabId - Unique identifier of the tab.
 * @param {boolean} isLoading - True to enable loading state, false to disable.
 */
export function setTabLoadingState(tabId, isLoading) {
    const runBtn = $(`#run-query-${tabId}`);
    const overlay = $(`#editor-loading-${tabId}`);
    const treeSelect = getHistoryTreeSelect(tabId);

    if (isLoading) {
        runBtn?.setAttribute('disabled', '');
        overlay?.classList.add('is-active');
        treeSelect?.disable();
    } else {
        runBtn?.removeAttribute('disabled');
        overlay?.classList.remove('is-active');
        treeSelect?.enable();
    }
}

/**
 * Initiates the query execution process for the specified tab.
 * @param {number} tabId - Unique identifier of the tab.
 */
export async function runQuery(tabId) {
    const getSql = () => {
        const editor = getEditor(tabId);
        if (editor) {
            return getSqlFromEditor(editor).sql;
        } else {
            // Fallback to textarea
            const textarea = $(`#sql-query-${tabId}`);
            const selection = textarea?.value.slice(textarea.selectionStart, textarea.selectionEnd).trim() || "";
            return selection || textarea?.value || "";
        }
    };

    setTabLoadingState(tabId, true);

    try {
        // Execute query - events will handle schema refresh automatically
        await executeQuery(tabId, getSql);
    } finally {
        setTabLoadingState(tabId, false);
    }
}

/**
 * Handle setting SQL in editor or textarea
 * @param {number} tabId - Tab ID
 * @param {string} sql - SQL to set
 */
function setSqlInEditor(tabId, sql) {
    const editor = getEditor(tabId);
    if (editor) {
        editor.setValue(sql);
    } else {
        const ta = $(`#sql-query-${tabId}`);
        if (ta) ta.value = sql;
    }
}

/**
 * Handle query selection from dropdown (with parameter support)
 * @param {number} tabId - Tab ID
 * @param {object} query - Query object from saved queries
 */
async function handleQuerySelect(tabId, query) {
    // Check if query has parameters
    if (queryNeedsParameters(query)) {
        // Show parameter input modal
        const finalSql = await showParameterInputModal(query);

        if (finalSql === null) {
            // User cancelled, don't update editor or run
            return;
        }

        // Set the substituted SQL in editor
        setSqlInEditor(tabId, finalSql);

        // Run the query with substituted values
        runQuery(tabId);
    } else {
        // No parameters, use SQL directly
        const sql = query.sql || query;
        setSqlInEditor(tabId, sql);
        runQuery(tabId);
    }
}

/**
 * Generates a tab-specific callback for handling query selection events.
 * Crucial for synchronizing saved query state across multiple active tabs.
 * @param {number} tabId - Tab ID.
 * @returns {Function} Handler function (query) => void.
 */
export function getQuerySelectHandler(tabId) {
    return (query) => handleQuerySelect(tabId, query);
}

// ============================================================================
// PRIVATE HANDLERS
// ============================================================================

/**
 * Handle save query action - triggers the save modal for the current editor content
 * @param {number} tabId - Tab ID
 */
export function saveQueryFromTab(tabId) {
    const editor = getEditor(tabId);
    const rawSql = editor
        ? editor.getValue().trim()
        : ($(`#sql-query-${tabId}`)?.value.trim() || "");

    showSaveQueriesModal(rawSql, async (queries, splitMode) => {
        const result = await saveQueries(rawSql, splitMode, queries);

        if (!result.success) {
            notify("Save", result.error, { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
            return;
        }

        const { saved, skipped } = result;

        if (saved && !skipped) {
            notify("Save", `Saved ${saved} quer${saved > 1 ? "ies" : "y"}`, { variant: "success", delay: NOTIFICATION_TIMING.SUCCESS });
        } else if (saved && skipped) {
            notify("Save", `Saved ${saved}, skipped ${skipped} duplicate${skipped > 1 ? "s" : ""}`, { variant: "success", delay: NOTIFICATION_TIMING.SUCCESS });
        } else {
            notify("Save", "All queries already saved", { variant: "secondary", delay: NOTIFICATION_TIMING.INFO });
        }

        // Reload history dropdown with proper callback
        await loadHistory(tabId, (query) => handleQuerySelect(tabId, query));
    });
}

/**
 * Handle manage queries action
 * @param {number} tabId - Tab ID
 */
async function handleManageQueries(tabId) {
    const items = await getQueries();

    showManageQueriesModal(items, async (updatedItems) => {
        const result = await updateQueries(updatedItems);

        if (!result.success) {
            notify("Manage", result.error, { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
            return;
        }

        notify("Manage", "Queries updated successfully", { variant: "success", delay: NOTIFICATION_TIMING.SUCCESS });

        // Reload history dropdown with proper callback
        await loadHistory(tabId, (query) => handleQuerySelect(tabId, query));
    });
}
