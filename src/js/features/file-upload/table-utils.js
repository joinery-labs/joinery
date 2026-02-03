/**
 * Table Utilities
 * Responsible for table existence checks and unique name generation
 */

import { tableExists } from '../../core/schema-cache.js';
import { quoteIdent, normalizeColumnLabels } from '../../utils/sql.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate a unique table name by appending a counter suffix.
 * @param {string} base - Base table name
 * @returns {Promise<string>} Unique table name
 */
export async function getUniqueTableName(base) {
    let name = base, c = 1;
    let needsRefresh = true;

    while (await tableExists(name, 'main', needsRefresh)) {
        needsRefresh = false;
        name = `${base}_${c++}`;
    }
    return name;
}

/**
 * Normalize column names in an existing table
 * @param {object} conn - DuckDB connection
 * @param {string} tableName - Table to normalize
 * @returns {Promise<void>}
 */
export async function normalizeTableColumns(conn, tableName) {
    try {
        const info = await conn.query(`PRAGMA table_info(${quoteIdent(tableName)});`);
        const cols = info.toArray().map(r => r.name);
        const { sql: newCols } = normalizeColumnLabels(cols, { fallback: "Column" });

        for (let i = 0; i < cols.length; i++) {
            if (newCols[i] !== cols[i]) {
                await conn.query(
                    `ALTER TABLE ${quoteIdent(tableName)} RENAME COLUMN ${quoteIdent(cols[i])} TO ${quoteIdent(newCols[i])};`
                );
            }
        }
    } catch (e) {
        console.warn("Column normalization warning:", e);
    }
}
