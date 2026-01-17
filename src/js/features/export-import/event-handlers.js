/**
 * Event Handlers Module
 * Configures DOM event listeners for export/import functionality.
 */

import { exportDatabase } from './database-export.js';
import { importDatabase } from './database-import.js';
import { copySchemaToClipboard } from './schema-export.js';
import { deleteDatabaseHandler } from './database-delete.js';
import { isTauri } from '../../platform/environment.js';
import { openFileDialogForPaths } from '../../platform/file-dialogs.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Initializes listeners for export and import UI elements.
 */
export function setupEventHandlers() {
    // Export database button
    const exportBtn = document.getElementById('exportDbBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportDatabase);
    }

    // Import database - platform-specific handling for memory efficiency
    const importInput = document.getElementById('importDbInput');
    const importLabel = importInput?.closest('label');

    if (isTauri() && importLabel) {
        // Tauri: Utilize native file dialogs for better integration and zero-copy performance.
        // We override the default label behavior to bypass the standard HTML file input.
        importLabel.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const paths = await openFileDialogForPaths({
                extensions: ['db', 'duckdb'],
                title: 'Import Database',
                multiple: false
            });

            if (paths.length > 0) {
                const filePath = paths[0];
                const fileName = filePath.split(/[/\\]/).pop();
                // Create minimal File object for name extraction only
                const file = new File([], fileName);
                await importDatabase(file, filePath);
            }
        });
    } else if (importInput) {
        // Web: Use standard HTML file input. The selected File object will be streamed to OPFS.
        importInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await importDatabase(file, null);
            e.target.value = "";
        });
    }

    // Delete database button
    const resetBtn = document.getElementById('resetDbBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', deleteDatabaseHandler);
    }

    // Copy schema button
    const copySchemaBtn = document.getElementById('copySchemaButton');
    if (copySchemaBtn) {
        copySchemaBtn.addEventListener('click', copySchemaToClipboard);
    }
}

