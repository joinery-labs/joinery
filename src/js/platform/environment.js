/**
 * Platform Environment Detection
 * 
 * Detects whether the application is running in a Tauri wrapper or a standard web browser.
 * Caches the result to minimize overhead.
 */

// Cached state
let _cachedIsTauri = null;

// Environment detection logic

/**
 * Checks if the application is running in the Tauri environment.
 * 
 * @returns {boolean} True if running in Tauri, false otherwise.
 */
export function isTauri() {
    if (_cachedIsTauri === null) {
        _cachedIsTauri = !!(window.__TAURI_INTERNALS__);
    }
    return _cachedIsTauri;
}

/**
 * Checks if the application is running in a standard web browser.
 * 
 * @returns {boolean} True if running in a browser, false if in Tauri.
 */
export function isWeb() {
    return !isTauri();
}

/**
 * Initializes the environment detection mechanism (ensures caching is set up).
 */
export function logEnvironment() {
    // Ensure environment detection cache is initialized
    isTauri();
}
