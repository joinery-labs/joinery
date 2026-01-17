/**
 * Config Store Abstraction
 *
 * Provides a unified API for key-value configuration storage (e.g., user themes).
 * Automatically selects the appropriate backend implementation based on the platform.
 */

import { isTauri } from './environment.js';

// Lazy-loaded backend modules
let webBackend = null;
let tauriBackend = null;

/**
 * Resolves the appropriate backend module for the current platform.
 * @returns {Promise<object>} The backend module containing platform-specific implementations.
 */
async function getBackend() {
    if (isTauri()) {
        if (!tauriBackend) {
            tauriBackend = await import('./backends/tauri/config-store.js');
        }
        return tauriBackend;
    } else {
        if (!webBackend) {
            webBackend = await import('./backends/web/config-store.js');
        }
        return webBackend;
    }
}

/**
 * Retrieves a configuration value by its key.
 * 
 * @param {string} key - The configuration key to retrieve (e.g., 'theme').
 * @returns {Promise<any>} The configuration value, or null if the key does not exist.
 */
export async function getConfig(key) {
    const backend = await getBackend();
    return backend.getConfig(key);
}

/**
 * Sets a configuration value.
 * 
 * @param {string} key - The configuration key.
 * @param {any} value - The value to store (must be JSON-serializable).
 * @returns {Promise<boolean>} True if the operation was successful.
 */
export async function setConfig(key, value) {
    const backend = await getBackend();
    return backend.setConfig(key, value);
}
