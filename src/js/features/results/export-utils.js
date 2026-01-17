/**
 * Export Utilities
 * Handles data export using DuckDB's COPY TO command.
 * 
 * Approaches:
 * - Tauri: DuckDB writes directly to the user-selected path.
 * - Web: DuckDB writes to internal VFS, which is then buffered to a blob for download.
 */

import { tableToIPC } from 'apache-arrow';
import { getConn, getActiveDbState } from '../../core/database.js';
import { dropFile, getTempDirPath, buildTempFilePath, copyFileToBuffer } from '../../core/duckdb-factory.js';
import { quoteIdent, sqlStringEscape } from '../../utils/sql.js';
import { isTauri } from '../../platform/environment.js';

// ============================================================================
// Format Configuration
// ============================================================================

const FORMAT_CONFIG = {
    csv: {
        options: '(FORMAT CSV, HEADER TRUE)',
        mime: 'text/csv;charset=utf-8',
        filename: 'query-result.csv',
        label: 'CSV'
    },
    json: {
        options: '(FORMAT JSON)',
        mime: 'application/json;charset=utf-8',
        filename: 'query-result.json',
        label: 'JSON'
    },
    parquet: {
        options: '(FORMAT PARQUET)',
        mime: 'application/octet-stream',
        filename: 'query-result.parquet',
        label: 'Parquet'
    }
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Export full result to CSV, JSON, or Parquet using DuckDB COPY TO.
 * Streams through DuckDB to avoid JavaScript string building.
 *  
 * @param {string} format - 'csv', 'json', or 'parquet'
 * @param {object} entry - Result entry containing columns and arrowTable
 * @returns {Promise<void>}
 */
export async function exportFullResult(format, entry) {
    const { columns, arrowTable } = entry;
    if (!columns || !columns.length) {
        throw new Error("No tabular result to export");
    }

    const config = FORMAT_CONFIG[format];
    if (!config) {
        throw new Error(`Unsupported export format: ${format}`);
    }

    if (!arrowTable) {
        throw new Error("No data to export");
    }

    const conn = getConn();
    const state = getActiveDbState();

    // Generate unique name for temp table
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tempTableName = `_export_temp_${suffix}`;

    try {
        // Insert Arrow table into temp table
        const ipcBuffer = tableToIPC(arrowTable, 'stream');
        await conn.insertArrowFromIPCStream(ipcBuffer, { name: tempTableName });

        if (isTauri()) {
            await exportResultTauri(conn, tempTableName, config);
        } else {
            await exportResultWeb(conn, state, tempTableName, format, config);
        }
    } finally {
        // Cleanup temp table
        try {
            await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(tempTableName)};`);
        } catch { /* ignore cleanup errors */ }
    }
}

// ============================================================================
// Tauri Export (Direct to Disk)
// ============================================================================

/**
 * Export result via Tauri - DuckDB writes directly to user's chosen path
 */
async function exportResultTauri(conn, tempTableName, config) {
    const dialog = await import('@tauri-apps/plugin-dialog');

    const ext = config.filename.split('.').pop();
    const destPath = await dialog.save({
        defaultPath: config.filename,
        title: 'Export Result',
        filters: [{ name: config.label, extensions: [ext] }]
    });

    if (!destPath) {
        throw new Error('Export cancelled');
    }

    // DuckDB writes directly to the chosen path
    const exportPath = destPath.replace(/\\/g, '/');
    const sql = `COPY (SELECT * FROM ${quoteIdent(tempTableName)}) TO '${sqlStringEscape(exportPath)}' ${config.options};`;
    await conn.query(sql);
}

// ============================================================================
// Web Export (VFS Buffer)
// ============================================================================

/**
 * Export result via Web - DuckDB writes to internal VFS, then buffer to download
 */
async function exportResultWeb(conn, state, tempTableName, format, config) {
    const virtualFileName = `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${format}`;
    const tempDir = await getTempDirPath(state);
    const exportPath = await buildTempFilePath(tempDir, virtualFileName);

    try {
        // DuckDB writes to internal VFS
        const sql = `COPY (SELECT * FROM ${quoteIdent(tempTableName)}) TO '${sqlStringEscape(exportPath)}' ${config.options};`;
        await conn.query(sql);

        // Read from VFS to buffer
        const buffer = await copyFileToBuffer(state, exportPath);

        // Trigger download
        const blob = new Blob([buffer], { type: config.mime });
        downloadBlob(blob, config.filename);
    } finally {
        // Cleanup VFS temp file
        try {
            await dropFile(state, exportPath);
        } catch { /* ignore cleanup errors */ }
    }
}

/**
 * Trigger blob download via temporary anchor element
 */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
}
