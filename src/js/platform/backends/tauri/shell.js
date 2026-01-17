/**
 * Tauri Shell Backend
 *
 * Provides capabilities to interact with the system shell in the Tauri environment.
 * Primarily used to open URLs in the user's default web browser.
 */

// Lazily loaded Tauri shell module.
let shell = null;

/**
 * Initializes the Tauri shell module if it hasn't been loaded yet.
 */
async function initShellModule() {
    if (!shell) {
        shell = await import('@tauri-apps/plugin-shell');
    }
}

/**
 * Opens the specified URL in the system's default web browser.
 *
 * @param {string} url - The URL to open.
 * @returns {Promise<boolean>} True if the URL was successfully opened, false otherwise.
 */
export async function openUrl(url) {
    try {
        await initShellModule();
        await shell.open(url);
        return true;
    } catch (e) {
        console.error('openUrl error:', e);
        return false;
    }
}
