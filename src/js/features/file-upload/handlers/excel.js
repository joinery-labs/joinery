/**
 * Excel File Handler
 * Handles Excel files (.xlsx, .xlsb, .xls) with multi-sheet support
 * Uses Arrow IPC for efficient bulk insertion
 * Progress updates are handled via callback, no direct toasts
 */

import * as XLSX from 'xlsx';
import { Table, tableToIPC, vectorFromArray, Utf8 } from 'apache-arrow';

import { getConn } from '../../../core/database.js';
import { emit, Events } from '../../../core/event-bus.js';
import { $ } from '../../../utils/dom.js';
import { inferTypesFromSample, coerceToType } from '../../../utils/type-inference.js';
import { sanitizeIdentifier, quoteIdent, normalizeColumnLabels } from '../../../utils/sql.js';

import { getUniqueTableName } from '../table-utils.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Process an Excel file, creating one table per sheet
 * Uses Arrow IPC bulk insertion for efficient data loading
 * @param {File} file - Excel file object to process
 * @param {Function} [onSheetProgress] - Callback for sheet progress: (sheetName, current, total) => void
 * @returns {Promise<object>} Result object {ok, file, tables?, rows?, createdTables?, error?}
 */
export async function handleExcelFile(file, onSheetProgress) {
    // Cache checkbox lookup before async operations
    const infer = $("#inferTypesChk")?.checked ?? false;

    return new Promise((resolve) => {
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const conn = getConn();
                const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
                const baseTableName = sanitizeIdentifier(file.name.replace(/\.[^/.]+$/, ""));
                const multi = wb.SheetNames.length > 1;

                let totalInserted = 0;
                const createdTables = [];
                const sheetTotal = wb.SheetNames.length;

                for (let sheetIdx = 0; sheetIdx < sheetTotal; sheetIdx++) {
                    const sheetName = wb.SheetNames[sheetIdx];

                    // Report sheet progress via callback if provided
                    onSheetProgress?.(sheetName, sheetIdx + 1, sheetTotal);

                    const sheet = wb.Sheets[sheetName];
                    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });

                    if (raw.length <= 1) continue;

                    const headersRaw = raw[0];
                    const { sql: headers } = normalizeColumnLabels(headersRaw);

                    let tableName = multi ? sanitizeIdentifier(`${baseTableName}_${sheetName}`) : baseTableName;
                    tableName = await getUniqueTableName(tableName);

                    const types = infer
                        ? inferTypesFromSample(headers, raw.slice(1, Math.min(2001, raw.length)))
                        : headers.map(() => "VARCHAR");

                    const dataRows = raw.slice(1);
                    const insertedCount = await insertViaArrowIPC(conn, tableName, headers, types, dataRows, infer);

                    totalInserted += insertedCount;
                    createdTables.push({ name: tableName, rows: insertedCount });
                }

                emit(Events.SCHEMA_CHANGED);
                resolve({ ok: true, file: file.name, tables: createdTables.length, rows: totalInserted, createdTables });
            } catch (err) {
                console.error("Excel upload error:", err);
                resolve({ ok: false, file: file.name, error: err.message });
            }
        };

        reader.onerror = () => {
            resolve({ ok: false, file: file.name, error: "File read failed" });
        };

        reader.readAsArrayBuffer(file);
    });
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Insert data via Arrow IPC bulk insertion
 * Much faster than row-by-row INSERT statements
 * @param {object} conn - DuckDB connection
 * @param {string} tableName - Target table name
 * @param {string[]} headers - Column names
 * @param {string[]} types - SQL types for each column
 * @param {Array[]} dataRows - Array of row arrays
 * @param {boolean} infer - Whether type inference is enabled
 * @returns {Promise<number>} Number of rows inserted
 */
async function insertViaArrowIPC(conn, tableName, headers, types, dataRows, infer) {
    if (dataRows.length === 0) return 0;

    // Build column data arrays
    const columnData = {};
    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
        const colName = headers[colIdx];
        const colType = types[colIdx];
        const values = [];

        for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
            const row = dataRows[rowIdx];
            const val = row?.[colIdx];
            // Coerce value based on type
            const coerced = infer
                ? coerceToType(val, colType)
                : (val == null || val === "" ? null : coerceToType(val, "VARCHAR"));
            values.push(coerced);
        }

        columnData[colName] = values;
    }

    // Create Arrow vectors for each column (all as VARCHAR for simplicity)
    // DuckDB will handle type conversion when inserting
    const vectors = {};
    for (const colName of headers) {
        const values = columnData[colName];
        const stringValues = values.map(v => v === null ? null : String(v));
        vectors[colName] = vectorFromArray(stringValues, new Utf8());
    }

    const arrowTable = new Table(vectors);
    const ipcBuffer = tableToIPC(arrowTable, 'stream');

    // Use temporary table then CREATE TABLE AS SELECT with proper type casts
    const tempName = `_excel_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
        await conn.insertArrowFromIPCStream(ipcBuffer, { name: tempName });

        const castExpressions = headers.map((h, i) => {
            const sqlType = types[i] || "VARCHAR";
            // For VARCHAR, no cast needed; for others, use TRY_CAST
            if (sqlType === "VARCHAR") {
                return `${quoteIdent(h)}`;
            }
            return `TRY_CAST(${quoteIdent(h)} AS ${sqlType}) AS ${quoteIdent(h)}`;
        }).join(", ");

        await conn.query(`CREATE TABLE ${quoteIdent(tableName)} AS SELECT ${castExpressions} FROM ${quoteIdent(tempName)};`);

        return dataRows.length;
    } finally {
        try {
            await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(tempName)};`);
        } catch { /* ignore cleanup errors */ }
    }
}
