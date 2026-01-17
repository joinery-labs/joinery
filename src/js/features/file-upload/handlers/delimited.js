/**
 * Delimited File Handler
 * Handles CSV, TSV, and other delimited text files
 * Progress is handled by file-router, no direct toasts
 */

import { getConn, getActiveDbState } from '../../../core/database.js';
import { registerFile } from '../../../core/duckdb-factory.js';
import { emit, Events } from '../../../core/event-bus.js';
import { $ } from '../../../utils/dom.js';
import { sanitizeIdentifier, quoteIdent, sqlStringEscape } from '../../../utils/sql.js';

import { getUniqueTableName } from '../table-utils.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Process a delimited file (CSV, TSV, etc.) using DuckDB's read_csv_auto
 * @param {File} file - File object to process
 * @returns {Promise<object>} Result object {ok, file, table?, rows?, error?}
 */
export async function handleDelimitedFile(file) {
    const infer = $("#inferTypesChk")?.checked ?? false;

    try {
        const state = getActiveDbState();
        const conn = getConn();

        const registeredPath = await registerFile(state, file.name, file);
        const readPath = registeredPath || file.name;

        const baseTableName = sanitizeIdentifier(file.name.replace(/\.[^/.]+$/, ""));
        const tableName = await getUniqueTableName(baseTableName);

        const opts = [
            'auto_detect=true',
            'ignore_errors=false',
            'normalize_names=true',
            infer ? 'sample_size=10000' : 'all_varchar=true'
        ];

        const createSQL = `
            CREATE TABLE ${quoteIdent(tableName)} AS
            SELECT * FROM read_csv_auto('${sqlStringEscape(readPath)}', ${opts.join(', ')});
        `;
        await conn.query(createSQL);

        const countResult = await conn.query(`SELECT COUNT(*) as cnt FROM ${quoteIdent(tableName)};`);
        const rowCount = countResult.toArray()[0]?.cnt || 0;

        emit(Events.SCHEMA_CHANGED);
        return { ok: true, file: file.name, table: tableName, rows: rowCount };
    } catch (err) {
        console.error("Delimited upload error:", err);
        return { ok: false, file: file.name, error: err.message };
    }
}

