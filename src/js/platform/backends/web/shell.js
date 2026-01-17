/**
 * Web Shell Backend
 *
 * Provides shell-like functionality for the web environment, primarily for opening external URLs.
 */

/**
 * Opens a URL in a new browser tab/window.
 * Note: Browser popup blockers may prevent this action if not triggered by a user gesture.
 *
 * @param {string} url - The URL to open.
 * @returns {Promise<boolean>} True if the window opening logic executed without error (though the new tab might still be blocked).
 */
export async function openUrl(url) {
    try {
        window.open(url, '_blank', 'noopener,noreferrer');
        return true;
    } catch (e) {
        console.error('openUrl error:', e);
        return false;
    }
}
