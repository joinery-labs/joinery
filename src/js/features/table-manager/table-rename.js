/**
 * Table Rename
 * 
 * Manages the table renaming workflow via modal interface.
 */

import { Modal } from 'bootstrap';

import { getConn } from '../../core/database.js';
import { notify, startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { ensureModal } from '../../ui/templates.js';
import { $ } from '../../utils/dom.js';
import { quoteIdent } from '../../utils/sql.js';
import { getCurrentSchema } from './table-state.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Opens the renaming modal for a specific table.
 * 
 * @param {string} tableName - Current name of the table.
 * @param {Function} onSuccess - Callback invoked after successful rename.
 */
export async function openRenameTableModal(tableName, onSuccess) {
    // Ensure modal exists (lazy loading)
    const modalEl = ensureModal('renameTableModal');
    if (!modalEl) return;

    const currentNameInput = $("#currentTableName");
    const newNameInput = $("#newTableName");

    if (!currentNameInput || !newNameInput) return;

    // Set current table name
    currentNameInput.value = tableName;
    newNameInput.value = "";

    // Show modal
    const modal = new Modal(modalEl);

    // Set up save button handler
    $("#renameTableSaveBtn").onclick = () => renameTable(tableName, onSuccess);

    // Handle Enter key in input
    newNameInput.onkeypress = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            renameTable(tableName, onSuccess);
        }
    };

    modal.show();

    // Focus on input after modal is shown (use once for cleanup)
    modalEl.addEventListener('shown.bs.modal', () => {
        newNameInput.focus();
    }, { once: true });
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Executes the table rename operation.
 * 
 * @param {string} oldName - Current table name.
 * @param {Function} onSuccess - Callback invoked on success.
 */
async function renameTable(oldName, onSuccess) {
    const newNameInput = $("#newTableName");
    const newName = newNameInput.value.trim();

    if (!newName) {
        notify("Rename Table", "Please enter a new table name.", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        newNameInput.focus();
        return;
    }

    if (newName === oldName) {
        notify("Rename Table", "New name must be different from current name.", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        newNameInput.focus();
        return;
    }

    const op = startNotification({
        title: 'Renaming Table',
        status: `Renaming to "${newName}"...`
    });

    const conn = getConn();
    const currentSchemaName = getCurrentSchema();

    try {
        const oldQualifiedName = currentSchemaName && currentSchemaName !== "main"
            ? `${quoteIdent(currentSchemaName)}.${quoteIdent(oldName)}`
            : quoteIdent(oldName);

        // Note: DuckDB's `ALTER TABLE ... RENAME TO` accepts only the new name (not schema-qualified)
        const newTableNameOnly = quoteIdent(newName);

        await conn.query(`ALTER TABLE ${oldQualifiedName} RENAME TO ${newTableNameOnly};`);

        // Close modal
        const modalEl = ensureModal('renameTableModal');
        const modal = Modal.getInstance(modalEl);
        if (modal) modal.hide();

        op.end({ success: true, message: `Renamed "${oldName}" to "${newName}"`, dismissDelay: NOTIFICATION_TIMING.SUCCESS });
        // Refresh the table list
        if (onSuccess) await onSuccess();

    } catch (e) {
        console.error("Rename table error:", e);
        op.end({ success: false, message: 'Rename failed', dismissDelay: NOTIFICATION_TIMING.ERROR, details: [e?.message || String(e)] });
    }
}