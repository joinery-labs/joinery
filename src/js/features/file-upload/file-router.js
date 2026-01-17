/**
 * File Router
 * Routes files to appropriate handlers based on file extension
 * Uses progress panel for live updates during processing
 */

import { startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { handleDelimitedFile } from './handlers/delimited.js';
import { handleExcelFile } from './handlers/excel.js';
import { handleJSONFile } from './handlers/json.js';
import { handleParquetFile } from './handlers/parquet.js';
import { handleZipFile } from './handlers/zip.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Process a list of files, routing each to the appropriate handler
 * @param {FileList} fileList - Files to process
 * @returns {Promise<void>}
 */
export async function handleFileList(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;

    const total = files.length;

    const op = startNotification({
        title: 'Uploading Files',
        status: `Processing ${total} file${total > 1 ? 's' : ''}...`,
        total
    });

    const results = [];

    // Process files sequentially to avoid race conditions with table naming
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = file.name.toLowerCase();

        op.update({
            status: `Processing file ${i + 1} of ${total}`,
            current: i
        });

        let result;

        try {
            if (/\.(csv|tsv|tab|txt|psv|dat|data|log)$/i.test(name)) {
                result = await handleDelimitedFile(file);
            } else if (/\.(xlsx|xlsb|xls)$/i.test(name)) {
                result = await handleExcelFile(file, (sheetName, current, sheetTotal) => {
                    op.update({
                        status: `Processing file ${i + 1} of ${total}`
                    });
                });
            } else if (/\.json$/i.test(name)) {
                result = await handleJSONFile(file);
            } else if (/\.parquet$/i.test(name)) {
                result = await handleParquetFile(file);
            } else if (/\.zip$/i.test(name)) {
                result = await handleZipFile(file, (current, zipTotal, fileName) => {
                    op.update({
                        status: `Processing file ${i + 1} of ${total}: extracting ${fileName}`
                    });
                });
            } else {
                result = { ok: false, file: file.name, error: "Unsupported file type" };
            }
        } catch (err) {
            const msg = err?.message || String(err);
            result = { ok: false, file: file.name, error: msg };
        }

        results.push(result);
    }

    op.update({
        status: 'Completing...',
        current: total
    });

    // Build notification details from results
    const { successLines, failLines, warnLines, successCount, failCount, warnCount } = buildNotificationDetails(results);

    // Combine all details - failures first, then warnings, then successes
    const allDetails = [...failLines, ...warnLines, ...successLines];

    const hasFailures = failCount > 0;
    const hasWarnings = warnCount > 0;

    op.end({
        success: !hasFailures,
        message: buildSummaryMessage(successCount, failCount, warnCount),
        dismissDelay: hasFailures ? NOTIFICATION_TIMING.ERROR : (hasWarnings ? NOTIFICATION_TIMING.WARNING : NOTIFICATION_TIMING.SUCCESS),
        details: allDetails
    });
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Build notification details from results array
 * @param {Array} results - Array of handler results
 * @returns {object} Object with successLines, failLines, warnLines, and counts
 */
function buildNotificationDetails(results) {
    const successLines = [];
    const failLines = [];
    const warnLines = [];

    for (const r of results) {
        if (!r) continue;

        if (r.ok) {
            // Success case
            if (Array.isArray(r.createdTables) && r.createdTables.length) {
                // Multi-table result (Excel sheets or zip contents)
                r.createdTables.forEach(t => {
                    successLines.push(`✓ ${r.file} → "${t.name}" (${(t.rows ?? 0).toLocaleString()} rows)`);
                });
            } else if (r.table) {
                successLines.push(`✓ ${r.file} → "${r.table}" (${(r.rows ?? 0).toLocaleString()} rows)`);
            }

            // Zip-specific: handle failed files within zip
            if (Array.isArray(r.failedFiles)) {
                r.failedFiles.forEach(f => {
                    failLines.push(`✗ ${r.file}/${f.file}: ${f.error || 'Unknown error'}`);
                });
            }

            // Zip-specific: handle skipped/unsupported files within zip
            if (Array.isArray(r.skippedFiles)) {
                r.skippedFiles.forEach(f => {
                    warnLines.push(`⚠ ${r.file}/${f.file}: ${f.reason || 'Skipped'}`);
                });
            }
        } else {
            // Failure case
            failLines.push(`✗ ${r.file}: ${r.error || 'Unknown error'}`);
        }
    }

    return {
        successLines,
        failLines,
        warnLines,
        successCount: successLines.length,
        failCount: failLines.length,
        warnCount: warnLines.length
    };
}

/**
 * Build summary message for notification
 * @param {number} successCount - Number of successful imports
 * @param {number} failCount - Number of failures
 * @param {number} warnCount - Number of warnings (skipped files)
 * @returns {string} Summary message
 */
function buildSummaryMessage(successCount, failCount, warnCount) {
    const parts = [];

    if (failCount > 0) {
        parts.push(`${failCount} failed`);
    }
    if (warnCount > 0) {
        parts.push(`${warnCount} skipped`);
    }
    if (successCount > 0) {
        parts.push(`${successCount} imported`);
    }

    if (parts.length === 0) {
        return 'No files processed';
    }

    return parts.join(', ');
}
