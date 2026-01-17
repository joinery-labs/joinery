/**
 * Common Handler Utilities
 * Shared utilities for JSON and Parquet handlers to eliminate duplication
 */

import { quoteIdent, normalizeColumnLabels } from '../../../utils/sql.js';

// ============================================================================
// INTERNAL UTILITIES
// ============================================================================

/**
 * Create a temporary table from a read function (read_json, read_parquet, etc.)
 * @param {object} conn - DuckDB connection
 * @param {string} tmpTable - Temporary table name
 * @param {string} readSQL - Complete SQL for reading (e.g., "SELECT * FROM read_json(...)")
 * @returns {Promise<void>}
 */
async function createTempTableFromRead(conn, tmpTable, readSQL) {
    await conn.query(`CREATE TEMP TABLE ${quoteIdent(tmpTable)} AS ${readSQL};`);
}

/**
 * Cast all columns to VARCHAR and create final table
 * @param {object} conn - DuckDB connection
 * @param {string} tmpTable - Source temporary table
 * @param {string} finalTable - Destination final table
 * @returns {Promise<void>}
 */
async function castColumnsToVarchar(conn, tmpTable, finalTable) {
    const info = await conn.query(`PRAGMA table_info(${quoteIdent(tmpTable)});`);
    const cols = info.toArray().map(r => r.name);
    const castList = cols.map(c => `CAST(${quoteIdent(c)} AS VARCHAR) AS ${quoteIdent(c)}`).join(", ");
    await conn.query(`CREATE TABLE ${quoteIdent(finalTable)} AS SELECT ${castList} FROM ${quoteIdent(tmpTable)};`);
}

/**
 * Normalize column names in an existing table
 * @param {object} conn - DuckDB connection
 * @param {string} tableName - Table to normalize
 * @returns {Promise<void>}
 */
async function normalizeTableColumns(conn, tableName) {
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
    } catch {
        // Ignore normalization errors
    }
}

/**
 * Clean up temporary table
 * @param {object} conn - DuckDB connection
 * @param {string} tmpTable - Temporary table name
 * @returns {Promise<void>}
 */
async function cleanupTempTable(conn, tmpTable) {
    try {
        await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(tmpTable)};`);
    } catch {
        // Ignore cleanup errors
    }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Process a file through temp table pattern (used by JSON and Parquet handlers)
 * Creates temp table, optionally casts to VARCHAR, normalizes columns, cleans up
 * @param {object} conn - DuckDB connection
 * @param {string} readSQL - SQL to read the file (e.g., "SELECT * FROM read_json(...)")
 * @param {string} finalTable - Final table name to create
 * @param {boolean} infer - Whether to infer types (if false, cast all to VARCHAR)
 * @returns {Promise<void>}
 */
export async function processFileWithTempTable(conn, readSQL, finalTable, infer) {
    const tmpTable = `_tmp_${Math.random().toString(36).slice(2, 10)}`;

    await createTempTableFromRead(conn, tmpTable, readSQL);

    try {
        if (!infer) {
            await castColumnsToVarchar(conn, tmpTable, finalTable);
        } else {
            await conn.query(`CREATE TABLE ${quoteIdent(finalTable)} AS SELECT * FROM ${quoteIdent(tmpTable)};`);
        }
        await normalizeTableColumns(conn, finalTable);
    } finally {
        await cleanupTempTable(conn, tmpTable);
    }
}
