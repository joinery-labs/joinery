/**
 * Database Export Module
 * Handles the export of the active database to a native .db file.
 * 
 * Implements platform-specific strategies for optimal performance:
 * - Tauri: Utilizes Rust backend for direct file operations to bypass Windows file locking.
 * - Web: Streams data via OPFS (Origin Private File System) to avoid large memory allocations.
 */

import { getActiveDbName, getDatabaseState } from '../../core/database.js';
import { forceCheckpoint } from '../../core/checkpoint-manager.js';
import { getDatabaseFileHandle } from '../../platform/database-path.js';
import { saveFileDialog } from '../../platform/file-dialogs.js';
import { isTauri } from '../../platform/environment.js';
import { startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Exports the currently active database as a .db file.
 * Automatically selects the most memory-efficient method based on the execution environment.
 */
export async function exportDatabase() {
    const op = startNotification({
        title: 'Exporting Database',
        status: 'Preparing export...'
    });

    try {
        const dbName = getActiveDbName();
        const state = getDatabaseState(dbName);

        // Check if database has persistent storage
        if (!state?.persistentPath) {
            op.end({
                success: false,
                message: 'Export failed',
                dismissDelay: NOTIFICATION_TIMING.ERROR,
                details: ['Database is not persisted - nothing to export']
            });
            return;
        }

        const exportName = `${dbName}.db`;

        if (isTauri()) {
            // Tauri: Delegate to Rust backend to handle potential Windows file locking issues.
            op.update({ status: 'Selecting destination...' });
            const { invoke } = await import('@tauri-apps/api/core');
            const dialog = await import('@tauri-apps/plugin-dialog');

            // Show save dialog to get destination path
            const destPath = await dialog.save({
                defaultPath: exportName,
                title: 'Export Database',
                filters: [{ name: 'Database', extensions: ['db'] }]
            });

            if (!destPath) {
                op.end({ success: false, message: 'Export cancelled', dismissDelay: NOTIFICATION_TIMING.WARNING });
                return;
            }

            op.update({ status: 'Exporting database...' });
            await invoke('duckdb_export_database', { handle: state.handle, destPath });
        } else {
            // Web: Stream directly from the OPFS File object to avoid copying to an ArrayBuffer.
            op.update({ status: 'Flushing data to disk...' });
            await forceCheckpoint();

            op.update({ status: 'Preparing download...' });
            const fileHandle = await getDatabaseFileHandle(dbName);
            const file = await fileHandle.getFile();

            // Create a Blob directly from the File object (which inherits from Blob).
            // This prevents loading the entire file contents into memory.
            op.update({ status: 'Starting download...' });
            const saved = await saveFileDialog(file, {
                suggestedName: exportName,
                mimeType: 'application/octet-stream'
            });

            if (!saved) {
                op.end({ success: false, message: 'Export cancelled', dismissDelay: NOTIFICATION_TIMING.WARNING });
                return;
            }
        }

        op.end({
            success: true,
            message: 'Database exported successfully',
            dismissDelay: NOTIFICATION_TIMING.SUCCESS
        });
    } catch (e) {
        console.error("Export error:", e);
        op.end({
            success: false,
            message: 'Export failed',
            dismissDelay: NOTIFICATION_TIMING.ERROR,
            details: [e.message]
        });
    }
}
