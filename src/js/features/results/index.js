/**
 * Results Display - Main Entry Point
 * Orchestrates module interactions.
 */

import { escapeHTML, $ } from '../../utils/dom.js';
import { fmtMs } from '../../utils/formatting.js';
import { notify, startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { storeResult, getResult, deleteResult } from './result-state.js';
import { exportFullResult } from './export-utils.js';
import { detectColumnTypesFromSchema } from './type-detection.js';
import { createPaginationControls, setupPaginationHandlers } from './pagination.js';
import {
    buildColumnMenuHTML,
    hydrateColumnMenuInputs,
    extractMenuValues,
    positionColumnMenu,
    setupColumnMenuInteractivity,
    initializeColumnMenuSelects,
    destroyColumnMenuSelects
} from './column-menu.js';
import { renderFilterChips } from './filter-chips.js';
import { setupFullscreenMode } from './fullscreen-mode.js';
import { renderPage } from './page-renderer.js';
import { openSaveResultModal } from './save-result.js';
import { createEditor, destroyEditor, getEditor, getSqlFromEditor } from '../query-editor/editor-factory.js';
import { executeStatements } from '../query-editor/query-executor.js';
import { setTabLoadingState } from '../query-editor/tab-controller.js';

// ============================================================================
// Constants
// ============================================================================

// Limit materialization for large result sets.
const MAX_CLIENT_ROWS = 1048576;

// Track active inline queries per tab to manage loading state.
/** @type {Map<number, number>} */
const runningInlineQueriesPerTab = new Map();

/**
 * Clean up inline query tracking for a closed tab
 * Called during tab removal to prevent orphaned Map entries
 * @param {number} tabId - Tab ID being closed
 */
export function cleanupInlineQueryTracking(tabId) {
    runningInlineQueriesPerTab.delete(tabId);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Render a result block with table, pagination, and controls
 * @param {string} title - Result block title
 * @param {Array<string>} columns - Column names
 * @param {object} opts - Options: pageSize, tookMs, querySQL, arrowTable, columnTypes, noToolbar, hideRowCount, maxClientRows
 * @returns {HTMLElement} Result block element
 */
export function renderResultBlock(title, columns, opts = {}) {
    const tookMs = opts.tookMs ?? null;
    const noToolbar = !!opts.noToolbar;
    const hideRowCount = !!opts.hideRowCount;
    const querySQL = opts.querySQL ?? null;

    const arrowTable = opts.arrowTable;
    if (!arrowTable) {
        throw new Error("arrowTable is required");
    }
    const columnTypes = opts.columnTypes || null;
    const rowCount = arrowTable.numRows;

    const entry = {
        columns,
        arrowTable,
        columnTypes,
        values: null, // Lazily materialized on-demand
        rowCount,
        allowClientOps: rowCount <= (opts.maxClientRows ?? MAX_CLIENT_ROWS)
    };

    const rid = storeResult(entry);

    const root = document.createElement("div");
    root.className = "result-block mb-3";
    root.setAttribute("data-rid", rid);

    // Query SQL display with edit button
    if (querySQL) {
        root.appendChild(createQuerySqlDisplay(querySQL, root));
    }

    // Header with title, row count, timing, and toolbar
    const header = createResultHeader(title, rowCount, tookMs, hideRowCount, noToolbar);
    root.appendChild(header);

    // Filter chips display
    const chips = document.createElement("div");
    chips.className = "d-flex flex-wrap active-filters mb-2";
    root.appendChild(chips);

    // Table
    const { tableWrap, thead, tbody, colTypes } = createResultTable(
        rid,
        columns,
        columnTypes
    );
    root.appendChild(tableWrap);

    // Pagination
    let pager = null;
    if (!noToolbar) {
        pager = createPaginationControls();
        root.appendChild(pager);
    }

    const PAGE_SIZE = opts.pageSize ?? 100;
    let page = 1;
    let sortCol = -1, sortAsc = true;
    let filterState = new Array(columns.length).fill(null);
    let lastTotalPages = 1;

    // Column menu
    const colmenu = document.createElement("div");
    colmenu.className = "colmenu shadow d-none";
    root.appendChild(colmenu);

    const ctrl = new AbortController();
    const { signal } = ctrl;

    // Base cleanup
    root.cleanup = () => {
        // Cleanup inline editor if active
        destroyEditor(`inline-editor-${rid}`);
        destroyColumnMenuSelects();
        deleteResult(rid);
        ctrl.abort();
    };

    // ========================================================================
    // INTERNAL HELPERS
    // ========================================================================

    function updateChips() {
        renderFilterChips(
            chips,
            columns,
            sortCol,
            sortAsc,
            filterState,
            () => {
                sortCol = -1;
                page = 1;
                updateChips();
                updatePage();
            },
            (idx) => {
                filterState[idx] = null;
                page = 1;
                updateChips();
                updatePage();
            }
        );
    }

    function updatePage() {
        const set = getResult(rid);
        const { totalPages, totalRows } = renderPage({
            tbody,
            pager,
            resultEntry: set,
            columns,
            page,
            pageSize: PAGE_SIZE,
            filterState,
            colTypes,
            sortCol,
            sortAsc
        });
        lastTotalPages = totalPages;
    }

    // ========================================================================
    // COLUMN MENU HANDLERS
    // ========================================================================

    function openColumnMenuAt(evt, colIdx, anchorTh) {
        evt.stopPropagation();

        const set = getResult(rid);
        if (set && set.arrowTable && !set.allowClientOps) {
            notify(
                "Result",
                "Sorting/filtering is disabled for large result sets. Please use SQL (WHERE / ORDER BY / LIMIT).",
                { variant: "warning", delay: NOTIFICATION_TIMING.WARNING }
            );
            return;
        }

        colmenu.innerHTML = buildColumnMenuHTML(columns[colIdx], colTypes[colIdx]);
        colmenu.classList.remove("d-none");

        positionColumnMenu(colmenu, anchorTh);
        hydrateColumnMenuInputs(colmenu, sortCol, colIdx, sortAsc, filterState[colIdx], colTypes[colIdx]);

        // Initialize TreeSelect instances for dropdown filters
        initializeColumnMenuSelects(colmenu, colTypes[colIdx], filterState[colIdx]);

        $(".btn-apply", colmenu).onclick = () => {
            applyMenu(colIdx);
            destroyColumnMenuSelects();
            colmenu.classList.add("d-none");
        };

        $(".btn-clear", colmenu).onclick = () => {
            filterState[colIdx] = null;
            if (sortCol === colIdx) { sortCol = -1; }
            page = 1;
            updateChips();
            updatePage();
            destroyColumnMenuSelects();
            colmenu.classList.add("d-none");
        };

        setupColumnMenuInteractivity(colmenu, signal);
    }

    function applyMenu(colIdx) {
        const { sortDir, filter } = extractMenuValues(colmenu, colTypes[colIdx]);

        if (sortDir === "asc") {
            sortCol = colIdx;
            sortAsc = true;
        } else if (sortDir === "desc") {
            sortCol = colIdx;
            sortAsc = false;
        } else if (sortDir === "none") {
            if (sortCol === colIdx) { sortCol = -1; }
        }

        filterState[colIdx] = filter;
        page = 1;
        updateChips();
        updatePage();
    }

    // Setup column header click handlers using event delegation
    thead.addEventListener("click", (ev) => {
        const th = ev.target.closest("th");
        if (!th) return;

        // Find the column index
        const cells = Array.from(thead.querySelectorAll("th"));
        const colIdx = cells.indexOf(th);
        if (colIdx === -1) return;

        openColumnMenuAt(ev, colIdx, th);
    }, { signal });

    // Close menu on outside click or ESC
    // Note: TreeSelect fixed menus are appended to body, so exclude them from outside click detection
    document.addEventListener("mousedown", (e) => {
        if (!colmenu.classList.contains("d-none") &&
            !colmenu.contains(e.target) &&
            !e.target.closest('th') &&
            !e.target.closest('.treeselect-menu.is-fixed')) {
            destroyColumnMenuSelects();
            colmenu.classList.add("d-none");
        }
    }, { signal });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !colmenu.classList.contains("d-none")) {
            destroyColumnMenuSelects();
            colmenu.classList.add("d-none");
        }
    }, { signal });

    // ========================================================================
    // TOOLBAR & FEATURE HANDLERS
    // ========================================================================

    if (!noToolbar) {
        setupExportHandlers(header, rid);
        setupSaveHandler(header, rid);
        setupPaginationHandlers(
            pager,
            (action) => {
                if (action === "prev") {
                    if (page > 1) {
                        page--;
                        updatePage();
                    }
                } else if (action === "next") {
                    if (page < lastTotalPages) {
                        page++;
                        updatePage();
                    }
                } else if (typeof action === "number") {
                    page = action;
                    updatePage();
                }
            },
            () => lastTotalPages
        );

        const expandBtn = $(".btn-expand", header);
        const fullscreen = setupFullscreenMode(root, tableWrap, expandBtn, signal);

        // Enhanced cleanup with fullscreen
        const baseCleanup = root.cleanup;
        root.cleanup = () => {
            try {
                fullscreen.cleanup();
            } finally {
                baseCleanup?.();
            }
        };
    }

    // Initial render
    updatePage();
    return root;
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Create query SQL display section with edit button
 * @param {string} querySQL - The SQL query to display
 * @param {HTMLElement} resultBlock - The parent result block element
 * @param {object} options - Optional configuration
 * @param {boolean} [options.isError=false] - If true, display SQL in error (red) color
 * @returns {HTMLElement} The query display container
 */
export function createQuerySqlDisplay(querySQL, resultBlock, options = {}) {
    const { isError = false } = options;
    const container = document.createElement("div");
    container.className = "result-sql-container";

    // Store full SQL for editing (even if display is truncated)
    let currentSQL = querySQL;

    // Create display mode element
    function createDisplayMode() {
        const queryDiv = document.createElement("div");
        queryDiv.className = "result-sql";

        const maxLen = 300;
        const isLong = currentSQL.length > maxLen;
        const shown = isLong ? (currentSQL.slice(0, maxLen) + "...") : currentSQL;

        const sqlSpan = document.createElement("span");
        sqlSpan.className = `label-muted fontcode result-sql-text${isError ? ' is-error' : ''}`;
        sqlSpan.textContent = shown;
        if (isLong) {
            sqlSpan.title = currentSQL; // Show full SQL on hover
        }
        queryDiv.appendChild(sqlSpan);

        const editBtn = document.createElement("button");
        editBtn.className = "btn btn-base";
        editBtn.type = "button";
        editBtn.title = "Edit SQL";
        editBtn.setAttribute("aria-label", "Edit SQL");
        editBtn.innerHTML = `<i class="bi bi-pencil-square"></i>`;
        editBtn.addEventListener("click", () => enterEditMode());
        queryDiv.appendChild(editBtn);

        return queryDiv;
    }

    // Create edit mode element with inline editor
    function createEditMode() {
        const rid = resultBlock.getAttribute("data-rid");
        const editorId = `inline-editor-${rid}`;
        const wrapId = `inline-editor-wrap-${rid}`;
        const hostId = `inline-editor-host-${rid}`;

        const editDiv = document.createElement("div");
        editDiv.className = "result-sql-edit";

        // Editor wrapper with loading overlay zone
        const editorWrap = document.createElement("div");
        editorWrap.id = wrapId;
        editorWrap.className = "editor-wrapper-inline loading-overlay-zone";

        const editorHost = document.createElement("div");
        editorHost.id = hostId;
        editorHost.style.height = "100%";
        editorWrap.appendChild(editorHost);

        // Loading overlay
        const overlay = document.createElement("div");
        overlay.className = "loading-overlay";
        overlay.innerHTML = `
            <div class="loading-overlay-spinner"></div>
            <span class="loading-overlay-text">Executing query...</span>
        `;
        editorWrap.appendChild(overlay);

        editDiv.appendChild(editorWrap);

        // Action buttons
        const actionsDiv = document.createElement("div");
        actionsDiv.className = "result-sql-edit-actions";

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn-base btn-sm secondary";
        cancelBtn.type = "button";
        cancelBtn.innerHTML = `<i class="bi bi-x-lg"></i>Cancel`;
        cancelBtn.addEventListener("click", () => exitEditMode(false));

        const runBtn = document.createElement("button");
        runBtn.className = "btn btn-base btn-sm primary";
        runBtn.type = "button";
        runBtn.innerHTML = `<i class="bi bi-play-circle"></i>Run`;

        actionsDiv.appendChild(cancelBtn);
        actionsDiv.appendChild(runBtn);
        editDiv.appendChild(actionsDiv);

        // Create the Monaco editor
        createEditor(
            wrapId,
            hostId,
            editorId,
            currentSQL,
            {
                lineNumbers: 'off',
                padding: { top: 5, bottom: 5 },
                onRun: () => runInlineQuery(editorId, runBtn, cancelBtn, overlay)
            },
            (editor, isFallback) => {
                if (editor) {
                    editor.focus();
                }
            }
        );

        // Run button click handler
        runBtn.addEventListener("click", () => runInlineQuery(editorId, runBtn, cancelBtn, overlay));

        return editDiv;
    }

    // Enter edit mode
    function enterEditMode() {
        container.innerHTML = "";
        container.appendChild(createEditMode());
    }

    // Exit edit mode (cancel or after successful query)
    function exitEditMode(updateSQL = false, newSQL = null) {
        const rid = resultBlock.getAttribute("data-rid");
        const editorId = `inline-editor-${rid}`;

        // Destroy the inline editor
        destroyEditor(editorId);

        // Update SQL if query was successful
        if (updateSQL && newSQL) {
            currentSQL = newSQL;
        }

        // Restore display mode
        container.innerHTML = "";
        container.appendChild(createDisplayMode());
    }

    // Run query from inline editor
    async function runInlineQuery(editorId, runBtn, cancelBtn, overlay) {
        const editor = getEditor(editorId);
        if (!editor) {
            notify("Query", "Editor not found", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
            return;
        }

        const { sql } = getSqlFromEditor(editor);

        // Find the parent tab's ID from DOM structure (result blocks are inside query-output-${tabId})
        const outputContainer = resultBlock.parentElement;
        const tabId = outputContainer?.id?.match(/^query-output-(\d+)$/)?.[1];
        const parsedTabId = tabId ? parseInt(tabId, 10) : null;

        // Show loading state: inline overlay visible, run button disabled, cancel button hidden
        overlay?.classList.add('is-active');
        runBtn?.setAttribute('disabled', '');
        if (cancelBtn) cancelBtn.style.display = 'none';

        // Track running inline queries per tab with reference counting
        // Only show tab loading state when first query starts, hide when last query ends
        if (parsedTabId !== null) {
            const currentCount = runningInlineQueriesPerTab.get(parsedTabId) || 0;
            runningInlineQueriesPerTab.set(parsedTabId, currentCount + 1);
            if (currentCount === 0) {
                // First query starting - show tab loading state
                setTabLoadingState(parsedTabId, true);
            }
        }

        try {
            // Create a temporary container to collect new result blocks
            // Using a real div instead of DocumentFragment since we need to check children after execution
            const tempContainer = document.createElement('div');

            // Execute statements using the shared executor
            await executeStatements(sql, tempContainer);

            // If any result blocks were created, replace the current block
            if (tempContainer.children.length > 0) {
                // outputContainer was already set above for tabId extraction

                // Find the position of the current result block
                const siblings = Array.from(outputContainer.children);
                const currentIndex = siblings.indexOf(resultBlock);

                // Cleanup and remove current result block
                resultBlock.cleanup?.();
                resultBlock.remove();

                // Insert all new result blocks at the same position
                if (currentIndex >= 0 && currentIndex < outputContainer.children.length) {
                    // Insert before the element that's now at currentIndex
                    const insertBefore = outputContainer.children[currentIndex];
                    while (tempContainer.firstChild) {
                        outputContainer.insertBefore(tempContainer.firstChild, insertBefore);
                    }
                } else {
                    // Append at end
                    while (tempContainer.firstChild) {
                        outputContainer.appendChild(tempContainer.firstChild);
                    }
                }
            }
        } finally {
            // Restore inline editor UI state (in case block wasn't replaced due to no results)
            overlay?.classList.remove('is-active');
            runBtn?.removeAttribute('disabled');
            if (cancelBtn) cancelBtn.style.display = '';

            // Decrement running count and only hide tab loading state when all queries complete
            if (parsedTabId !== null) {
                const currentCount = runningInlineQueriesPerTab.get(parsedTabId) || 1;
                const newCount = currentCount - 1;
                if (newCount <= 0) {
                    // Last query finished - hide tab loading state
                    runningInlineQueriesPerTab.delete(parsedTabId);
                    setTabLoadingState(parsedTabId, false);
                } else {
                    runningInlineQueriesPerTab.set(parsedTabId, newCount);
                }
            }
        }
    }

    // Initialize with display mode
    container.appendChild(createDisplayMode());
    return container;
}

/**
 * Create result header with title, stats, and toolbar
 */
function createResultHeader(title, rowCount, tookMs, hideRowCount, noToolbar) {
    const header = document.createElement("div");
    header.className = "result-header";

    const metaDiv = document.createElement("div");
    metaDiv.className = "result-meta";
    metaDiv.innerHTML = `
        <div class="result-meta-item">
          <p class="label-base" style="margin: 0;">${escapeHTML(title)}</p>
        </div>
        ${hideRowCount ? "" : `
        <div class="result-meta-item">
          <i class="bi bi-table"></i>
          <p class="label-muted" style="margin: 0;">${rowCount} row${rowCount !== 1 ? "s" : ""}</p>
        </div>`}
        ${tookMs != null ? `
        <div class="result-meta-item">
          <i class="bi bi-clock"></i>
          <p class="label-muted" style="margin: 0;">${fmtMs(tookMs)}</p>
        </div>` : ""}
    `;
    header.appendChild(metaDiv);

    if (!noToolbar) {
        const controls = document.createElement("div");
        controls.className = "result-controls d-flex gap-2";
        controls.innerHTML = `
            <button class="btn btn-base btn-sm btn-expand" title="Expand" aria-label="Expand table">
                <i class="bi bi-arrows-angle-expand"></i>
            </button>
            <button class="btn btn-base btn-sm btn-save" title="Save to Database" aria-label="Save to Database">
                <i class="bi bi-floppy"></i>
            </button>
            <div class="btn-group">
                <button type="button" class="btn btn-base btn-sm dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false" title="Download" aria-label="Download options">
                    <i class="bi bi-download"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li>
                        <button class="dropdown-item btn-dl-csv" type="button">
                            <i class="bi bi-filetype-csv me-2"></i>CSV
                        </button>
                    </li>
                    <li>
                        <button class="dropdown-item btn-dl-json" type="button">
                            <i class="bi bi-filetype-json me-2"></i>JSON
                        </button>
                    </li>
                    <li>
                        <button class="dropdown-item btn-dl-parquet" type="button">
                            <i class="bi bi-file-binary me-2"></i>Parquet
                        </button>
                    </li>
                </ul>
            </div>
        `;
        header.appendChild(controls);
    }

    return header;
}

/**
 * Create result table structure
 */
function createResultTable(rid, columns, columnTypes) {
    const tableWrap = document.createElement("div");
    tableWrap.className = "fs-table";
    tableWrap.id = `result-table-${rid}`;

    const table = document.createElement("table");
    table.className = "table table-base mb-0";

    const thead = document.createElement("thead");
    const thr = document.createElement("tr");

    const colTypes = detectColumnTypesFromSchema(columnTypes, columns.length);

    columns.forEach((c) => {
        const th = document.createElement("th");
        th.textContent = c;
        th.style.cursor = "pointer";
        th.title = "Click to sort/filter";
        thr.appendChild(th);
    });
    thead.appendChild(thr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    return { tableWrap, thead, tbody, colTypes };
}

/**
 * Setup export button handlers
 */
function setupExportHandlers(header, rid) {
    $(".btn-dl-csv", header).addEventListener("click", async () => {
        const set = getResult(rid);
        if (!set) {
            notify("Export", "No result to export", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
            return;
        }
        const rowCount = set.arrowTable.numRows;
        const op = startNotification({ title: 'Exporting CSV', status: 'Preparing...' });
        try {
            await exportFullResult("csv", set);
            op.end({ success: true, message: `Exported ${rowCount} row${rowCount === 1 ? '' : 's'} as CSV`, dismissDelay: NOTIFICATION_TIMING.SUCCESS });
        } catch (e) {
            op.end({ success: false, message: 'Export failed', dismissDelay: NOTIFICATION_TIMING.ERROR, details: [e?.message || 'Export operation failed'] });
        }
    });

    $(".btn-dl-json", header).addEventListener("click", async () => {
        const set = getResult(rid);
        if (!set) {
            notify("Export", "No result to export", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
            return;
        }
        const rowCount = set.arrowTable.numRows;
        const op = startNotification({ title: 'Exporting JSON', status: 'Preparing...' });
        try {
            await exportFullResult("json", set);
            op.end({ success: true, message: `Exported ${rowCount} row${rowCount === 1 ? '' : 's'} as JSON`, dismissDelay: NOTIFICATION_TIMING.SUCCESS });
        } catch (e) {
            op.end({ success: false, message: 'Export failed', dismissDelay: NOTIFICATION_TIMING.ERROR, details: [e?.message || 'Export operation failed'] });
        }
    });

    $(".btn-dl-parquet", header).addEventListener("click", async () => {
        const set = getResult(rid);
        if (!set) {
            notify("Export", "No result to export", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
            return;
        }
        const rowCount = set.arrowTable.numRows;
        const op = startNotification({ title: 'Exporting Parquet', status: 'Preparing...' });
        try {
            await exportFullResult("parquet", set);
            op.end({ success: true, message: `Exported ${rowCount} row${rowCount === 1 ? '' : 's'} as Parquet`, dismissDelay: NOTIFICATION_TIMING.SUCCESS });
        } catch (e) {
            op.end({ success: false, message: 'Export failed', dismissDelay: NOTIFICATION_TIMING.ERROR, details: [e?.message || 'Export operation failed'] });
        }
    });
}

/**
 * Setup save button handler
 */
function setupSaveHandler(header, rid) {
    const btn = $(".btn-save", header);
    if (btn) {
        btn.addEventListener("click", () => openSaveResultModal(rid));
    }
}
