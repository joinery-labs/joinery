/**
 * Schema Export Module
 * Generates and exports SQL schema definitions, optionally including sample data.
 * Utilizes the notification system to provide user feedback during the copy operation.
 */

import { getConn } from '../../core/database.js';
import { startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { downloadBlob } from '../../utils/dom.js';
import { quoteIdent, sqlStringEscape } from '../../utils/sql.js';
import {
    normalizeTypeName,
    isIntegerType,
    isFloatType,
    isBooleanType,
    isDateOnlyType,
    isTimestampType,
    isTimeOnlyType
} from '../../utils/types.js';
import { coerceToType } from '../../utils/type-inference.js';
import { formatDateSafe, formatDateTimeSafe, formatTimeSafe } from '../../utils/date-parsing.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Copies the database schema to the system clipboard.
 * Includes optional sample data rows based on user input.
 * Falls back to a file download if clipboard access is unavailable.
 */
export async function copySchemaToClipboard() {
    const op = startNotification({
        title: 'Copying Schema',
        status: 'Generating SQL...'
    });

    try {
        const inputEl = document.getElementById('schemaSampleRowsInput');
        let n = Number.parseInt(inputEl?.value ?? '3', 10);
        if (!Number.isFinite(n) || n < 0) n = 0;

        const sql = await generateSchemaSQL(n);

        // Primary: Attempt specific clipboard write.
        let clipboardSucceeded = false;
        try {
            await navigator.clipboard.writeText(sql);
            clipboardSucceeded = true;
        } catch {
            // Fallback: Trigger file download if clipboard access fails.
            downloadBlob(sql, "application/sql;charset=utf-8", "schema.sql");
        }

        op.end({
            success: true,
            message: clipboardSucceeded ? 'Schema copied to clipboard' : 'Downloaded (clipboard unavailable)',
            dismissDelay: NOTIFICATION_TIMING.SUCCESS
        });
    } catch (err) {
        console.error("Schema copy error:", err);
        op.end({ success: false, message: 'Schema copy failed', dismissDelay: NOTIFICATION_TIMING.ERROR, details: [(err && err.message) ? String(err.message) : 'Unknown error'] });
    }
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Generates a complete SQL schema string for the active database.
 * 
 * @param {number} maxRowsPerTable - The maximum number of sample rows to include per table.
 * @returns {Promise<string>} The generated SQL schema string.
 */
async function generateSchemaSQL(maxRowsPerTable = 3) {
    const parts = [];

    try {
        const conn = getConn();

        const versionResult = await conn.query(`SELECT version() as version;`);
        const version = versionResult.toArray()[0]?.version || 'unknown';
        const hdr = `-- joinery schema export\n-- generated for use in DuckDB-WASM environments\n-- DuckDB version: ${version}\n\n`;
        parts.push(hdr);

        const result = await conn.query(`
            SELECT table_schema, table_name
            FROM information_schema.tables 
            WHERE table_type='BASE TABLE'
                AND table_catalog = current_database()
                AND table_schema NOT IN ('information_schema')
            ORDER BY table_schema, table_name;
        `);

        const tables = result.toArray();
        if (!tables.length) { parts.push("-- (no tables)\n"); return parts.join(""); }

        const seenSchemas = new Set();

        for (const { table_schema, table_name } of tables) {
            const schemaName = table_schema || "main";
            const qualifiedName =
                schemaName && schemaName !== "main" ? `${quoteIdent(schemaName)}.${quoteIdent(table_name)}` : quoteIdent(table_name);

            if (schemaName && schemaName !== "main" && !seenSchemas.has(schemaName)) {
                parts.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schemaName)};\n\n`);
                seenSchemas.add(schemaName);
            }

            const createRes = await conn.query(`
        SELECT sql 
        FROM duckdb_tables() 
        WHERE database_name = current_database()
          AND schema_name='${sqlStringEscape(schemaName)}'
          AND table_name='${sqlStringEscape(table_name)}';
      `);
            const createSQL = createRes.toArray()[0]?.sql;
            if (createSQL) {
                const ddl = String(createSQL).trim().replace(/;+\s*$/, '');
                parts.push(ddl + ";\n");
            }

            if (maxRowsPerTable <= 0) { parts.push("\n"); continue; }

            const colInfo = await conn.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema='${sqlStringEscape(schemaName)}' 
          AND table_name='${sqlStringEscape(table_name)}' 
        ORDER BY ordinal_position;
      `);
            const columns = colInfo.toArray();
            const colNames = columns.map(c => quoteIdent(c.column_name)).join(", ");

            const arrowTable = await conn.query(`SELECT * FROM ${qualifiedName} LIMIT ${maxRowsPerTable};`);

            if (arrowTable.numRows > 0) {
                const valueTuples = [];

                for (let rowIdx = 0; rowIdx < arrowTable.numRows; rowIdx++) {
                    const tupleVals = columns.map((colMeta, colIdx) => {
                        const col = arrowTable.getChildAt(colIdx);
                        let val = col.get(rowIdx);

                        if (val == null) return 'NULL';

                        return formatValueForSQL(val, colMeta.data_type);
                    }).join(", ");

                    valueTuples.push(`  (${tupleVals})`);
                }

                parts.push(`INSERT INTO ${qualifiedName} (${colNames}) VALUES\n`);
                parts.push(valueTuples.join(",\n"));
                parts.push(";\n");
            }

            parts.push("\n");
        }

        return parts.join("");
    } catch (err) {
        console.error("Schema generation error:", err);
        return `-- Error generating schema: ${err.message}\n`;
    }
}

/**
 * Formats a single value for a SQL INSERT statement based on its DuckDB data type.
 * 
 * @param {*} val - The value to format.
 * @param {string} dataType - The DuckDB data type definition.
 * @returns {string} The formatted SQL string compatible with DuckDB.
 */
function formatValueForSQL(val, dataType) {
    if (val == null) return 'NULL';

    const normalized = normalizeTypeName(dataType);

    // Boolean types
    if (isBooleanType(dataType)) {
        return val ? 'TRUE' : 'FALSE';
    }

    // Integer types
    if (isIntegerType(dataType)) {
        return String(val);
    }

    // Float types
    if (isFloatType(dataType)) {
        return String(val);
    }

    // Date only
    if (isDateOnlyType(dataType)) {
        const result = formatDateSafe(val);
        if (result) return `DATE '${result}'`;
        return `'${sqlStringEscape(String(val))}'`;
    }

    // Timestamp types
    if (isTimestampType(dataType)) {
        const result = formatDateTimeSafe(val);
        if (result) return `TIMESTAMP '${result}'`;
        return `'${sqlStringEscape(String(val))}'`;
    }

    // Time only types
    if (isTimeOnlyType(dataType)) {
        if (val instanceof Date) {
            const result = formatTimeSafe(val);
            if (result) return `TIME '${result}'`;
        }
        return `TIME '${sqlStringEscape(String(val))}'`;
    }

    // INTERVAL type
    if (normalized === "INTERVAL") {
        // Intervals are usually represented as strings or objects
        // DuckDB accepts INTERVAL 'value' format
        return `INTERVAL '${sqlStringEscape(String(val))}'`;
    }

    // UUID type
    if (normalized === "UUID") {
        return `UUID '${sqlStringEscape(String(val))}'`;
    }

    // JSON type
    if (normalized === "JSON") {
        if (typeof val === "object" && val !== null) {
            try {
                return `'${sqlStringEscape(JSON.stringify(val))}'`;
            } catch {
                return `'${sqlStringEscape(String(val))}'`;
            }
        }
        return `'${sqlStringEscape(String(val))}'`;
    }

    // BLOB type - handle binary data
    if (normalized === "BLOB") {
        if (val instanceof Uint8Array || val instanceof ArrayBuffer) {
            // Convert to hex string
            const bytes = val instanceof ArrayBuffer ? new Uint8Array(val) : val;
            const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
            return `'\\x${hex}'`;
        }
        return `'${sqlStringEscape(String(val))}'`;
    }

    // BIT type
    if (normalized === "BIT") {
        return `'${sqlStringEscape(String(val))}'`;
    }

    // Default: Handle as string (VARCHAR and others).
    // Note: We use coerceToType to consistently handle BigInt and timestamp string representations.
    // passing 'dataType' as both source and target preserves original type intent during export.
    const coerced = coerceToType(val, dataType, dataType);
    return `'${sqlStringEscape(String(coerced))}'`;
}
