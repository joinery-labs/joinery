/**
 * Saved Queries Store Abstraction
 * 
 * Provides a unified API for storing and retrieving saved SQL queries.
 * Automatically selects the appropriate backend implementation based on the platform.
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
            tauriBackend = await import('./backends/tauri/saved-queries-store.js');
        }
        return tauriBackend;
    } else {
        if (!webBackend) {
            webBackend = await import('./backends/web/saved-queries-store.js');
        }
        return webBackend;
    }
}

/**
 * Retrieves all saved queries.
 * 
 * @returns {Promise<Array>} An array of saved query objects.
 */
export async function getSavedQueries() {
    const backend = await getBackend();
    return backend.getSavedQueries();
}

/**
 * Replaces all saved queries with a new set.
 * 
 * @param {Array} queries - The new array of query objects.
 * @returns {Promise<boolean>} True if the operation was successful.
 */
export async function setSavedQueries(queries) {
    const backend = await getBackend();
    return backend.setSavedQueries(queries);
}

/**
 * Adds a new saved query.
 * 
 * @param {object} query - The query object {name, sql, parameters}.
 * @returns {Promise<{success: boolean, id?: string, error?: string}>} The result of the operation.
 */
export async function addSavedQuery(query) {
    const backend = await getBackend();
    return backend.addSavedQuery(query);
}

/**
 * Updates an existing saved query.
 * 
 * @param {string} id - The unique ID of the query to update.
 * @param {object} updates - The fields to update {name?, sql?, parameters?}.
 * @returns {Promise<{success: boolean, error?: string}>} The result of the operation.
 */
export async function updateSavedQuery(id, updates) {
    const backend = await getBackend();
    return backend.updateSavedQuery(id, updates);
}

/**
 * Deletes a saved query.
 * 
 * @param {string} id - The unique ID of the query to delete.
 * @returns {Promise<{success: boolean, error?: string}>} The result of the operation.
 */
export async function deleteSavedQuery(id) {
    const backend = await getBackend();
    return backend.deleteSavedQuery(id);
}
