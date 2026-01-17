/**
 * Table Actions
 * 
 * Encapsulates high-level table operations such as deletion.
 */

import { getConn } from '../../core/database.js';
import { startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { quoteIdent } from '../../utils/sql.js';
import { $ } from '../../utils/dom.js';
import { getCurrentSchema, setLastSelectedTable } from './table-state.js';
import { showConfirm } from '../../ui/confirm-modal.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Deletes (DROP) a table after user confirmation.
 * 
 * @param {string} tableName - Name of the table to delete.
 * @param {Function} onSuccess - Callback invoked upon successful deletion.
 */
export async function deleteTable(tableName, onSuccess) {
    if (!tableName) return;

    const ok = await showConfirm(`Delete table "${tableName}"? This cannot be undone.`);
    if (!ok) return;

    const op = startNotification({
        title: 'Deleting Table',
        status: `Dropping "${tableName}"...`
    });

    try {
        const conn = getConn();
        const currentSchemaName = getCurrentSchema();

        const qualifiedName =
            currentSchemaName && currentSchemaName !== "main"
                ? `${quoteIdent(currentSchemaName)}.${quoteIdent(tableName)}`
                : quoteIdent(tableName);

        await conn.query(`DROP TABLE ${qualifiedName};`);

        // Clear selection and refresh
        setLastSelectedTable(currentSchemaName, null);
        $("#tableSchema").innerHTML = "";

        op.end({ success: true, message: `Dropped "${tableName}"`, dismissDelay: NOTIFICATION_TIMING.SUCCESS });
        if (onSuccess) await onSuccess();
    } catch (e) {
        op.end({ success: false, message: 'Delete failed', dismissDelay: NOTIFICATION_TIMING.ERROR, details: [e?.message || String(e)] });
    }
}
