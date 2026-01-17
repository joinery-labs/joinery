/**
 * JSON File Handler
 * Handles JSON files using DuckDB's read_json
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
 * Process a JSON file using DuckDB's read_json
 * @param {File} file - JSON file object to process
 * @returns {Promise<object>} Result object {ok, file, table?, rows?, error?}
 */
export async function handleJSONFile(file) {
    const infer = $("#inferTypesChk")?.checked ?? false;

    try {
        const state = getActiveDbState();
        const conn = getConn();

        const registeredPath = await registerFile(state, file.name, file);
        const readPath = registeredPath || file.name;

        const base = sanitizeIdentifier(file.name.replace(/\.[^/.]+$/, ""));
        const finalTable = await getUniqueTableName(base);

        // Calculate max object size based on file size with reasonable bounds
        const capMin = 64 * 1024 * 1024;   // 64 MB
        const capMax = 512 * 1024 * 1024;  // 512 MB
        const maxObj = Math.max(capMin, Math.min(file.size + (1 << 20), capMax));

        const opts = [
            "auto_detect=true",
            `sample_size=${infer ? 20480 : 10000}`,
            `maximum_object_size=${maxObj}`
        ];

        const readSQL = `SELECT * FROM read_json('${sqlStringEscape(readPath)}', ${opts.join(", ")})`;
        await processFileWithTempTable(conn, readSQL, finalTable, infer);

        const rowCount = (await conn.query(`SELECT COUNT(*) as cnt FROM ${quoteIdent(finalTable)};`)).toArray()[0]?.cnt || 0;

        emit(Events.SCHEMA_CHANGED);
        return { ok: true, file: file.name, table: finalTable, rows: rowCount };
    } catch (err) {
        console.error("JSON upload error:", err);
        return { ok: false, file: file.name, error: err.message };
    }
}
