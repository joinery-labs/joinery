/**
 * Query Executor
 * 
 * Handles the actual execution of SQL queries against the database connection.
 * Manages the execution lifecycle, including progress feedback and result rendering.
 */

import { getConn } from '../../core/database.js';
import { notify, startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { $, $$ } from '../../utils/dom.js';
import { fmtMs } from '../../utils/formatting.js';
import { splitSQLStatements, classifySQL, canonicalizeStatement } from '../../utils/sql.js';
import { renderResultBlock, createQuerySqlDisplay } from '../results/index.js';
import { destroyEditor } from './editor-factory.js';
import { emit, Events } from '../../core/event-bus.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Execute SQL statements and append results to output container.
 * Core execution function used by both tab and inline editors.
 * 
 * @param {string} sql - SQL to execute (may contain multiple statements).
 * @param {HTMLElement} output - Container to append result blocks to.
 * @param {object} options - Optional configuration object.
 * @param {function} [options.onBeforeExecute] - Callback invoked before execution starts, receives total statement count.
 * @param {function} [options.onComplete] - Callback invoked after all statements complete, receives {success, hasDDL}.
 * @returns {Promise<{success: boolean, hasDDL: boolean}>} Result of the execution batch.
 */
export async function executeStatements(sql, output, options = {}) {
    if (!sql.trim()) {
        notify("Query", "Nothing to run", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        return { success: false, hasDDL: false };
    }

    const statements = splitSQLStatements(sql);
    if (!statements.length) {
        notify("Query", "No valid statements", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        return { success: false, hasDDL: false };
    }

    const conn = getConn();
    const total = statements.length;

    // Notify before execution starts
    options.onBeforeExecute?.(total);

    // Initialize and display the progress notification panel
    const op = startNotification({
        title: total > 1 ? 'Running Queries' : 'Running Query',
        status: total > 1 ? `Executing ${total} queries...` : 'Executing query...',
        total: total > 1 ? total : undefined
    });

    try {
        let hasDDL = false;
        let errorCount = 0;
        const failedQueries = [];

        for (let i = 0; i < statements.length; i++) {
            const q = statements[i];
            const start = performance.now();
            const compact = canonicalizeStatement(q);

            // Update progress indicator when executing a batch of queries
            if (total > 1) {
                op.update({
                    status: `Running query ${i + 1} of ${total}`,
                    current: i
                });
            }

            try {
                const arrowTable = await conn.query(q);
                const took = performance.now() - start;

                const kind = classifySQL(q);

                // Track if any DDL operations occurred
                if (kind === 'DDL' || kind === 'DML') {
                    hasDDL = true;
                }

                const schema = arrowTable.schema;
                const columns = schema.fields.map(f => f.name);
                const columnTypes = schema.fields.map(f => f.type?.toString?.() ?? String(f.type || ""));

                const block = renderResultBlock(
                    "Result",
                    columns,
                    {
                        pageSize: 100,
                        tookMs: took,
                        querySQL: compact,
                        arrowTable,
                        columnTypes
                    }
                );
                output.appendChild(block);
            } catch (err) {
                errorCount++;
                const took = performance.now() - start;

                // Track failed query for notification details
                const preview = compact.length > 60 ? compact.slice(0, 57) + '...' : compact;
                failedQueries.push(`${preview}: ${err.message}`);

                // Create error block with edit button
                const errorBlock = document.createElement("div");
                errorBlock.className = "result-block mb-3";

                // Generate unique ID for error block (needed for inline editor)
                const errorRid = `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                errorBlock.setAttribute("data-rid", errorRid);

                // Add editable SQL display with error styling
                const sqlDisplay = createQuerySqlDisplay(compact, errorBlock, { isError: true });
                errorBlock.appendChild(sqlDisplay);

                // Error header with timing
                const headerDiv = document.createElement("div");
                headerDiv.className = "d-flex justify-content-between align-items-center mb-2";
                headerDiv.innerHTML = `
                    <div class="small text-muted">
                        <strong>Error</strong>
                        <span class="ms-2">Time: ${fmtMs(took)}</span>
                    </div>
                `;
                errorBlock.appendChild(headerDiv);

                // Error message
                const errorMsg = document.createElement("p");
                errorMsg.className = "label-muted fontcode text-danger mb-0";
                errorMsg.textContent = `Error: ${err.message}`;
                errorBlock.appendChild(errorMsg);

                // Cleanup function for editor
                errorBlock.cleanup = () => {
                    destroyEditor(`inline-editor-${errorRid}`);
                };

                output.appendChild(errorBlock);
                console.error("Query error:", err);
            }
        }

        // Emit schema change event if data modification occurred, triggering UI updates
        // This prompts refreshes of the table dropdown and intellisense cache
        if (hasDDL) {
            emit(Events.SCHEMA_CHANGED);
        }

        // End progress panel
        const successCount = total - errorCount;
        const success = errorCount === 0;
        op.end({
            success,
            message: success
                ? (total > 1 ? `Completed ${total} queries` : 'Query complete')
                : (total > 1 ? `${successCount} succeeded, ${errorCount} failed` : 'Query failed'),
            dismissDelay: success ? NOTIFICATION_TIMING.SUCCESS : NOTIFICATION_TIMING.ERROR,
            details: errorCount > 0 ? failedQueries : undefined
        });

        // Notify completion
        options.onComplete?.({ success, hasDDL });

        return { success, hasDDL };
    } catch (err) {
        // Unexpected error - include details in progress notification
        op.end({
            success: false,
            message: 'Execution failed',
            dismissDelay: NOTIFICATION_TIMING.ERROR,
            details: [err?.message || String(err)]
        });
        options.onComplete?.({ success: false, hasDDL: false });
        return { success: false, hasDDL: false };
    }
}

/**
 * Execute queries in a tab
 * @param {number} tabId - Tab ID
 * @param {function} getSqlFn - Function to get SQL from editor: () => string
 * @returns {Promise<void>}
 */
export async function runQueryInTab(tabId, getSqlFn) {
    const output = $(`#query-output-${tabId}`);
    const sql = getSqlFn();

    // Cleanup previous results
    for (const el of $$(".result-block", output)) {
        el.cleanup?.();
    }
    output.innerHTML = "";

    await executeStatements(sql, output);
}
