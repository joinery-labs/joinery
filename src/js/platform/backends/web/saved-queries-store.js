/**
 * Web Saved Queries Store Backend
 *
 * This module handles the persistence of saved SQL queries in the web environment using OPFS.
 * Queries are stored in a JSON file at `joinery/saved_queries/saved_queries.json`.
 */

import { readJsonFile, writeJsonFile } from './opfs-utils.js';

const QUERIES_PATH = 'joinery/saved_queries';
const QUERIES_FILE = 'saved_queries.json';
const STORAGE_VERSION = 'v1';

/**
 * Generates a unique identifier for a new query.
 *
 * @returns {string} A unique string ID.
 */
function generateId() {
    return 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

/**
 * Reads and parses the saved queries data from the storage file.
 * Ensures the returned data structure contains the necessary `version` and `queries` fields.
 *
 * @returns {Promise<{version: string, queries: Array}>} The parsed storage data.
 */
async function readStorage() {
    const data = await readJsonFile(QUERIES_PATH, QUERIES_FILE);
    // Ensure version and queries exist
    if (!data.version) {
        data.version = STORAGE_VERSION;
    }
    if (!data.queries) {
        data.queries = [];
    }
    return data;
}

/**
 * Writes the saved queries data to the storage file.
 *
 * @param {object} data - The data object to be written to storage.
 * @returns {Promise<boolean>} True if the write operation was successful.
 */
async function writeStorage(data) {
    return writeJsonFile(QUERIES_PATH, QUERIES_FILE, data);
}

/**
 * Retrieves all saved queries.
 *
 * @returns {Promise<Array>} A promise resolving to an array of saved query objects.
 */
export async function getSavedQueries() {
    const data = await readStorage();
    return data.queries || [];
}

/**
 * Overwrites the entire list of saved queries.
 *
 * @param {Array} queries - The new array of query objects to store.
 * @returns {Promise<boolean>} True if the operation was successful.
 */
export async function setSavedQueries(queries) {
    return writeStorage({
        version: STORAGE_VERSION,
        queries: queries
    });
}

/**
 * Adds a new query to the saved queries list.
 * Checks for duplicate names before adding. The list is capped at the 100 most recent queries.
 *
 * @param {object} query - The query object containing details like name, SQL, and parameters.
 * @returns {Promise<{success: boolean, id?: string, error?: string}>} An object indicating success or failure.
 */
export async function addSavedQuery(query) {
    try {
        const data = await readStorage();
        const queries = data.queries || [];

        // Check for duplicate name (case-insensitive)
        const nameKey = query.name.trim().toLowerCase();
        const exists = queries.some(q =>
            (q.name || '').trim().toLowerCase() === nameKey
        );
        if (exists) {
            return { success: false, error: 'Query name already exists' };
        }

        const newQuery = {
            id: generateId(),
            name: query.name.trim(),
            sql: query.sql,
            parameters: query.parameters || [],
            folder: query.folder || '/',
            ts: Date.now()
        };

        queries.unshift(newQuery);

        // Keep only latest 100
        while (queries.length > 100) {
            queries.pop();
        }

        const ok = await writeStorage({ version: STORAGE_VERSION, queries });
        return ok
            ? { success: true, id: newQuery.id }
            : { success: false, error: 'Storage not available' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Updates an existing saved query identified by its ID.
 * If the name is being updated, it checks for potential duplicates.
 *
 * @param {string} id - The ID of the query to update.
 * @param {object} updates - An object containing the fields to update (name, sql, parameters).
 * @returns {Promise<{success: boolean, error?: string}>} An object indicating success or failure.
 */
export async function updateSavedQuery(id, updates) {
    try {
        const data = await readStorage();
        const queries = data.queries || [];
        const index = queries.findIndex(q => q.id === id);

        if (index === -1) {
            return { success: false, error: 'Query not found' };
        }

        // If name is being updated, check for duplicates
        if (updates.name) {
            const nameKey = updates.name.trim().toLowerCase();
            const exists = queries.some((q, i) =>
                i !== index && (q.name || '').trim().toLowerCase() === nameKey
            );
            if (exists) {
                return { success: false, error: 'Query name already exists' };
            }
        }

        queries[index] = {
            ...queries[index],
            ...updates,
            ts: Date.now()
        };

        const ok = await writeStorage({ version: STORAGE_VERSION, queries });
        return ok
            ? { success: true }
            : { success: false, error: 'Storage not available' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Deletes a saved query by its ID.
 *
 * @param {string} id - The ID of the query to delete.
 * @returns {Promise<{success: boolean, error?: string}>} An object indicating success or failure.
 */
export async function deleteSavedQuery(id) {
    try {
        const data = await readStorage();
        const queries = data.queries || [];
        const index = queries.findIndex(q => q.id === id);

        if (index === -1) {
            return { success: false, error: 'Query not found' };
        }

        queries.splice(index, 1);

        const ok = await writeStorage({ version: STORAGE_VERSION, queries });
        return ok
            ? { success: true }
            : { success: false, error: 'Storage not available' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}
