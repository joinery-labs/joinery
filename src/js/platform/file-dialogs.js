/**
 * File Dialogs Abstraction
 * 
 * Provides a unified API for file import/export operations.
 * Uses HTML file input for the web and native dialogs for Tauri.
 */

import { isTauri } from './environment.js';

// Lazily loaded backend modules
let webBackend = null;
let tauriBackend = null;

/**
 * Resolves the appropriate backend module for the current platform.
 * @returns {Promise<object>} The backend module.
 */
async function getBackend() {
    if (isTauri()) {
        if (!tauriBackend) {
            tauriBackend = await import('./backends/tauri/file-dialogs.js');
        }
        return tauriBackend;
    } else {
        if (!webBackend) {
            webBackend = await import('./backends/web/file-dialogs.js');
        }
        return webBackend;
    }
}

/**
 * Opens a file picker dialog.
 * 
 * @param {object} options - Dialog options.
 * @param {string[]} [options.extensions] - Allowed file extensions (e.g., ['csv', 'json']).
 * @param {boolean} [options.multiple=false] - Whether to allow multiple file selection.
 * @param {string} [options.title] - Dialog title (Tauri only).
 * @returns {Promise<File[]>} An array of selected File objects.
 */
export async function openFileDialog(options = {}) {
    const backend = await getBackend();
    return backend.openFileDialog(options);
}

/**
 * Saves data to a file via a save dialog.
 * 
 * @param {Blob|Uint8Array|string} data - The data to save.
 * @param {object} options - Save options.
 * @param {string} options.suggestedName - The suggested filename.
 * @param {string} [options.mimeType] - The MIME type (for web downloads).
 * @param {string} [options.title] - Dialog title (Tauri only).
 * @param {string[]} [options.extensions] - Allowed extensions (Tauri only).
 * @returns {Promise<boolean>} True if the save was successful.
 */
export async function saveFileDialog(data, options = {}) {
    const backend = await getBackend();
    return backend.saveFileDialog(data, options);
}

/**
 * Initiates a direct file download (programmatic export).
 * 
 * Bypasses the save dialog on the web.
 * 
 * @param {Blob|Uint8Array|string} data - The data to download.
 * @param {string} mimeType - The MIME type of the file.
 * @param {string} filename - The filename for the download.
 * @returns {Promise<boolean>} True if the download was initiated successfully.
 */
export async function downloadFile(data, mimeType, filename) {
    const backend = await getBackend();
    return backend.downloadFile(data, mimeType, filename);
}

/**
 * Opens a file picker dialog that returns paths or File objects.
 * 
 * - Tauri: Returns an array of file paths (strings) for direct filesystem operations.
 * - Web: Returns an array of File objects (browsers do not expose paths).
 * 
 * Use this when filesystem-level operations (e.g., copyFile) are required.
 * 
 * @param {object} options - Dialog options.
 * @param {string[]} [options.extensions] - Allowed file extensions.
 * @param {boolean} [options.multiple=false] - Whether to allow multiple file selection.
 * @param {string} [options.title] - Dialog title (Tauri only).
 * @returns {Promise<string[]|File[]>} File paths (Tauri) or File objects (Web).
 */
export async function openFileDialogForPaths(options = {}) {
    const backend = await getBackend();
    return backend.openFileDialogForPaths(options);
}
