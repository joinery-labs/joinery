/**
 * Shell Abstraction
 * 
 * Provides a unified API for shell-like operations, such as opening external URLs.
 * Uses the system default browser in Tauri and a new tab in the web environment.
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
            tauriBackend = await import('./backends/tauri/shell.js');
        }
        return tauriBackend;
    } else {
        if (!webBackend) {
            webBackend = await import('./backends/web/shell.js');
        }
        return webBackend;
    }
}

/**
 * Opens a URL in the system's default browser (Tauri) or a new tab (Web).
 * 
 * @param {string} url - The URL to open.
 * @returns {Promise<boolean>} True if the operation was successful.
 */
export async function openUrl(url) {
    const backend = await getBackend();
    return backend.openUrl(url);
}
