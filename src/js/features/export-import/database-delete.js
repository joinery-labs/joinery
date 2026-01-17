/**
 * Database Deletion Module
 * Handles the deletion of the active database, including user confirmation
 * and UI notifications.
 */

import { getActiveDbName, deleteDatabase } from '../../core/database.js';
import { emit, Events } from '../../core/event-bus.js';
import { startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { showConfirm } from '../../ui/confirm-modal.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Handles the database deletion process.
 * Prompts the user for confirmation before permanently removing the active database.
 */
export async function deleteDatabaseHandler() {
    const dbName = getActiveDbName();
    if (!await showConfirm(`Delete the "${dbName}" database? This will permanently remove all data.`)) return;

    const op = startNotification({
        title: 'Deleting Database',
        status: `Deleting "${dbName}"...`
    });

    try {
        await deleteDatabase(dbName);

        // Emit schema:changed event to refresh dependent UI components (e.g., table dropdowns, intellisense)
        emit(Events.SCHEMA_CHANGED);

        op.end({ success: true, message: 'Database deleted', dismissDelay: NOTIFICATION_TIMING.SUCCESS });
    } catch (e) {
        console.error("Delete error:", e);
        op.end({ success: false, message: 'Delete failed', dismissDelay: NOTIFICATION_TIMING.ERROR, details: [e.message] });
    }
}
