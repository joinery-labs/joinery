/**
 * Result State Management
 * Stores and retrieves result data.
 */

// ============================================================================
// STATE
// ============================================================================

const resultStore = new Map();
let resultIdCounter = 1;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Store a result entry and return its unique ID
 * @param {object} entry - Result entry containing columns, arrowTable, columnTypes (values computed lazily)
 * @returns {string} Unique result ID
 */
export function storeResult(entry) {
    const id = "r" + (resultIdCounter++);
    resultStore.set(id, entry);
    return id;
}

/**
 * Get a stored result entry by ID
 * @param {string} id - Result ID
 * @returns {object|undefined} Result entry or undefined if not found
 */
export function getResult(id) {
    return resultStore.get(id);
}

/**
 * Delete a result entry by ID
 * @param {string} id - Result ID
 */
export function deleteResult(id) {
    resultStore.delete(id);
}
