/**
 * Zip File Handler
 * Extracts zip contents and routes files to appropriate handlers
 */

import JSZip from 'jszip';

import { handleDelimitedFile } from './delimited.js';
import { handleExcelFile } from './excel.js';
import { handleJSONFile } from './json.js';
import { handleParquetFile } from './parquet.js';

// Supported file extension patterns mapped to handlers
const FILE_HANDLERS = [
    { pattern: /\.(csv|tsv|tab|txt|psv|dat|data|log)$/i, handler: handleDelimitedFile },
    { pattern: /\.(xlsx|xlsb|xls)$/i, handler: handleExcelFile },
    { pattern: /\.json$/i, handler: handleJSONFile },
    { pattern: /\.parquet$/i, handler: handleParquetFile }
];

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Process a zip file by extracting and routing contents to handlers
 * @param {File} zipFile - Zip file to process
 * @param {Function} [onProgress] - Callback: (current, total, fileName) => void
 * @returns {Promise<object>} Result with createdTables[], failedFiles[], skippedFiles[]
 */
export async function handleZipFile(zipFile, onProgress) {
    try {
        const zip = await JSZip.loadAsync(zipFile);

        // Collect file entries (excludes directories)
        const entries = [];
        zip.forEach((path, entry) => {
            if (!entry.dir) {
                entries.push({ path, entry });
            }
        });

        if (entries.length === 0) {
            return { ok: false, file: zipFile.name, error: "Zip file is empty" };
        }

        const createdTables = [];
        const failedFiles = [];
        const skippedFiles = [];
        const total = entries.length;

        for (let i = 0; i < entries.length; i++) {
            const { path, entry } = entries[i];
            entries[i] = null;

            const fileName = path.split('/').pop();

            onProgress?.(i, total, fileName);

            const handler = getHandler(fileName);
            if (!handler) {
                skippedFiles.push({ file: fileName, reason: "Unsupported file type" });
                continue;
            }

            try {
                const blob = await entry.async('blob');
                const file = new File([blob], fileName);
                const result = await handler(file);

                if (result.ok) {
                    if (Array.isArray(result.createdTables) && result.createdTables.length) {
                        createdTables.push(...result.createdTables);
                    } else if (result.table) {
                        createdTables.push({ name: result.table, rows: result.rows ?? 0 });
                    }
                } else {
                    failedFiles.push({ file: fileName, error: result.error || "Unknown error" });
                }
            } catch (err) {
                failedFiles.push({ file: fileName, error: err.message || String(err) });
            }
        }

        const hasSuccess = createdTables.length > 0;
        const hasFailures = failedFiles.length > 0;
        const hasSkipped = skippedFiles.length > 0;

        return {
            ok: hasSuccess,
            file: zipFile.name,
            createdTables,
            failedFiles,
            skippedFiles,
            error: !hasSuccess && (hasFailures || hasSkipped)
                ? `No files imported (${failedFiles.length} failed, ${skippedFiles.length} unsupported)`
                : undefined
        };
    } catch (err) {
        return { ok: false, file: zipFile.name, error: err.message || "Failed to read zip file" };
    }
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Get handler for a file based on extension
 */
function getHandler(fileName) {
    const lowerName = fileName.toLowerCase();
    for (const { pattern, handler } of FILE_HANDLERS) {
        if (pattern.test(lowerName)) {
            return handler;
        }
    }
    return null;
}
