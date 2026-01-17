/**
 * Table Utilities
 * Responsible for table existence checks and unique name generation
 */

import { getConn } from '../../core/database.js';
import { sqlStringEscape } from '../../utils/sql.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Check if a table exists in the database
 * @param {string} tableName - Table name to check
 * @returns {Promise<boolean>} True if table exists
 */
async function tableExists(tableName) {
    try {
        const conn = getConn();
        const result = await conn.query(
            `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_name='${sqlStringEscape(tableName)}';`
        );
        const rows = result.toArray();
        return rows.length > 0 && rows[0].cnt > 0;
    } catch {
        return false;
    }
}

/**
 * Generate a unique table name by appending a counter suffix
 * @param {string} base - Base table name
 * @returns {Promise<string>} Unique table name
 */
export async function getUniqueTableName(base) {
    let name = base, c = 1;
    while (await tableExists(name)) {
        name = `${base}_${c++}`;
    }
    return name;
}
