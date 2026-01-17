/**
 * Export Operations
 * 
 * Orchestrates table exports to CSV, JSON, and Parquet formats.
 * 
 * Strategy:
 * - Desktop (Tauri): Uses DuckDB `COPY TO` with direct filesystem access (zero JS memory overhead).
 * - Web: Uses DuckDB `COPY TO` with virtual filesystem, then buffers to a Blob for download.
 */

import { getConn, getActiveDbState } from '../../core/database.js';
import { dropFile, getTempDirPath, buildTempFilePath, copyFileToBuffer } from '../../core/duckdb-factory.js';
import { startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { quoteIdent, sqlStringEscape } from '../../utils/sql.js';
import { getCurrentSchema } from './table-state.js';
import { isTauri } from '../../platform/environment.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const FORMAT_CONFIG = {
    csv: {
        options: '(FORMAT CSV, HEADER TRUE)',
        mime: 'text/csv;charset=utf-8',
        label: 'CSV'
    },
    json: {
        options: '(FORMAT JSON)',
        mime: 'application/json;charset=utf-8',
        label: 'JSON'
    },
    parquet: {
        options: '(FORMAT PARQUET)',
        mime: 'application/octet-stream',
        label: 'Parquet'
    }
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Initiates the table export process.
 * @param {string} tableName - Name of the table to export.
 * @param {string} format - Target format ('csv', 'json', 'parquet').
 */
export async function exportTable(tableName, format) {
    if (!tableName) return;

    const fmt = (format || "").toLowerCase();
    const config = FORMAT_CONFIG[fmt];

    if (!config) {
        const opErr = startNotification({ title: 'Export Error', status: 'Invalid format' });
        opErr.end({ success: false, message: `Unsupported format: ${format}`, dismissDelay: NOTIFICATION_TIMING.ERROR });
        return;
    }

    const downloadName = `${tableName}.${fmt}`;

    const currentSchemaName = getCurrentSchema();
    const qualifiedName =
        currentSchemaName && currentSchemaName !== "main"
            ? `${quoteIdent(currentSchemaName)}.${quoteIdent(tableName)}`
            : quoteIdent(tableName);

    const op = startNotification({
        title: 'Exporting Table',
        status: `Exporting ${tableName} as ${config.label}...`
    });

    try {
        if (isTauri()) {
            await exportTableTauri(qualifiedName, downloadName, config, op);
        } else {
            await exportTableWeb(qualifiedName, downloadName, fmt, config, op);
        }
    } catch (e) {
        console.error("Export error:", e);
        op.end({ success: false, message: 'Export failed', dismissDelay: NOTIFICATION_TIMING.ERROR, details: [e?.message || String(e)] });
    }
}

// ============================================================================
// Tauri Export (Direct to Disk)
// ============================================================================

/**
 * Executes export in Tauri environment.
 * DuckDB writes directly to the user's selected file path.
 */
async function exportTableTauri(qualifiedName, downloadName, config, op) {
    const conn = getConn();

    // Show save dialog
    op.update({ status: 'Selecting destination...' });
    const dialog = await import('@tauri-apps/plugin-dialog');

    const ext = downloadName.split('.').pop();
    const destPath = await dialog.save({
        defaultPath: downloadName,
        title: 'Export Table',
        filters: [{ name: config.label, extensions: [ext] }]
    });

    if (!destPath) {
        op.end({ success: false, message: 'Export cancelled', dismissDelay: NOTIFICATION_TIMING.WARNING });
        return;
    }

    // DuckDB writes directly to the chosen path
    op.update({ status: 'Exporting...' });
    const exportPath = destPath.replace(/\\/g, '/'); // Normalize for DuckDB
    const sql = `COPY (SELECT * FROM ${qualifiedName}) TO '${sqlStringEscape(exportPath)}' ${config.options};`;

    await conn.query(sql);
    op.end({ success: true, message: `Exported "${downloadName}"`, dismissDelay: NOTIFICATION_TIMING.SUCCESS });
}

// ============================================================================
// Web Export (VFS Buffer)
// ============================================================================

/**
 * Executes export in Web environment.
 * DuckDB writes to the virtual filesystem (VFS), which is then read into a buffer for download.
 * Required because WASM cannot write directly to the local filesystem.
 */
async function exportTableWeb(qualifiedName, downloadName, fmt, config, op) {
    const conn = getConn();
    const state = getActiveDbState();

    const virtualFileName = `wb_export_${Date.now()}_${Math.random().toString(36).slice(2)}.${fmt}`;
    const tempDir = await getTempDirPath(state);
    const exportPath = await buildTempFilePath(tempDir, virtualFileName);

    try {
        // DuckDB writes to internal VFS
        op.update({ status: 'Exporting data...' });
        const sql = `COPY (SELECT * FROM ${qualifiedName}) TO '${sqlStringEscape(exportPath)}' ${config.options};`;
        await conn.query(sql);

        // Read from VFS to buffer
        op.update({ status: 'Preparing download...' });
        const buffer = await copyFileToBuffer(state, exportPath);

        // Trigger download
        const blob = new Blob([buffer], { type: config.mime });
        downloadBlob(blob, downloadName);

        op.end({ success: true, message: `Downloaded "${downloadName}"`, dismissDelay: NOTIFICATION_TIMING.SUCCESS });
    } finally {
        // Cleanup VFS temp file
        try {
            await dropFile(state, exportPath);
        } catch { }
    }
}

/**
 * Triggers a browser download for the given blob.
 * @param {Blob} blob - The file data.
 * @param {string} filename - The target filename.
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
