/**
 * Table State Management
 * 
 * Maintains the application state for the Table Manager, including
 * current schema and table selection persistence.
 */

// ============================================================================
// STATE
// ============================================================================
const lastSelectedTableBySchema = Object.create(null);
let currentSchemaName = "main";

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Retrieves the currently active schema name.
 * @returns {string} One of: schema name, "main", or "temp".
 */
export function getCurrentSchema() {
    return currentSchemaName;
}

/**
 * Sets the active schema name.
 * @param {string} name - Schema name to activate.
 */
export function setCurrentSchema(name) {
    currentSchemaName = name || "main";
}

/**
 * Retrieves the last selected table for a specific schema.
 * @param {string} schema - Target schema.
 * @returns {string|null} Table name, or null if none selected previously.
 */
export function getLastSelectedTable(schema) {
    return lastSelectedTableBySchema[schema] || null;
}

/**
 * Updates the last selected table for a specific schema.
 * @param {string} schema - Schema name.
 * @param {string|null} tableName - Selected table name.
 */
export function setLastSelectedTable(schema, tableName) {
    lastSelectedTableBySchema[schema] = tableName;
}
