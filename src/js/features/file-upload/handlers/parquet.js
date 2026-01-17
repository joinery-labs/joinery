/**
 * Parquet File Handler
 * Handles Parquet files using DuckDB's read_parquet
 * Progress is handled by file-router, no direct toasts
 */

import { getConn, getActiveDbState } from '../../../core/database.js';
import { registerFile } from '../../../core/duckdb-factory.js';
import { emit, Events } from '../../../core/event-bus.js';
import { $ } from '../../../utils/dom.js';
import { sanitizeIdentifier, quoteIdent, sqlStringEscape } from '../../../utils/sql.js';

import { getUniqueTableName } from '../table-utils.js';
import { processFileWithTempTable } from './common.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Process a Parquet file using DuckDB's read_parquet
 * @param {File} file - Parquet file object to process
 * @returns {Promise<object>} Result object {ok, file, table?, rows?, error?}
 */
export async function handleParquetFile(file) {
    const infer = $("#inferTypesChk")?.checked ?? false;

    try {
        const state = getActiveDbState();
        const conn = getConn();

        const registeredPath = await registerFile(state, file.name, file);
        const readPath = registeredPath || file.name;

        const base = sanitizeIdentifier(file.name.replace(/\.[^/.]+$/, ""));
        const finalTable = await getUniqueTableName(base);

        const readSQL = `SELECT * FROM read_parquet('${sqlStringEscape(readPath)}')`;
        await processFileWithTempTable(conn, readSQL, finalTable, infer);

        const rowCount = (await conn.query(`SELECT COUNT(*) as cnt FROM ${quoteIdent(finalTable)};`)).toArray()[0]?.cnt || 0;

        emit(Events.SCHEMA_CHANGED);
        return { ok: true, file: file.name, table: finalTable, rows: rowCount };
    } catch (err) {
        console.error("Parquet upload error:", err);
        return { ok: false, file: file.name, error: err.message };
    }
}
