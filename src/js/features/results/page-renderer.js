/**
 * Page Renderer
 * Renders table rows for the current page.
 */

import { formatCellValue } from './type-detection.js';
import { getActiveRows } from './data-preparation.js';
import { updatePaginationState } from './pagination.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Render the current page of results
 * @param {object} params - Rendering parameters
 * @param {HTMLElement} params.tbody - Table body element
 * @param {HTMLElement} params.pager - Pagination element (optional)
 * @param {object} params.resultEntry - Result entry from store
 * @param {Array<string>} params.columns - Column names
 * @param {number} params.page - Current page number
 * @param {number} params.pageSize - Rows per page
 * @param {Array} params.filterState - Filter state
 * @param {Array<string>} params.colTypes - Column types
 * @param {number} params.sortCol - Sort column index
 * @param {boolean} params.sortAsc - Sort direction
 * @returns {object} {totalPages, totalRows} - Pagination info
 */
export function renderPage({
    tbody,
    pager,
    resultEntry,
    columns,
    page,
    pageSize,
    filterState,
    colTypes,
    sortCol,
    sortAsc
}) {
    tbody.innerHTML = "";

    if (!resultEntry) {
        return { totalPages: 1, totalRows: 0 };
    }

    const hasArrow = !!resultEntry.arrowTable;
    const filtersActive = filterState.some(f => f != null);
    const sortActive = sortCol >= 0;

    // Use Arrow directly if client ops are disabled (large result) or no active filters/sorts.
    const useDirectArrow =
        hasArrow && (!resultEntry.allowClientOps || (!filtersActive && !sortActive));

    let totalPages, totalRows;

    if (useDirectArrow) {
        // Direct Arrow rendering (no materialization)
        const tbl = resultEntry.arrowTable;
        totalRows = resultEntry.rowCount || tbl.numRows || 0;
        totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

        const currentPage = Math.min(Math.max(1, page), totalPages);
        const start = (currentPage - 1) * pageSize;
        const end = Math.min(totalRows, start + pageSize);

        const colCount = columns.length;
        const colsArr = new Array(colCount);
        for (let j = 0; j < colCount; j++) colsArr[j] = tbl.getChildAt(j);
        const typeArr = resultEntry.columnTypes || [];

        for (let r = start; r < end; r++) {
            const tr = document.createElement("tr");
            for (let c = 0; c < colCount; c++) {
                const td = document.createElement("td");
                let v = colsArr[c] ? colsArr[c].get(r) : null;
                v = formatCellValue(v, typeArr[c]);
                td.textContent = v == null ? "" : String(v);
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
    } else {
        // Filtered/sorted rendering (materialized)
        const { values: filteredRows } = getActiveRows(
            resultEntry,
            columns,
            filterState,
            colTypes,
            sortCol,
            sortAsc
        );
        totalRows = filteredRows.length;
        totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

        const currentPage = Math.min(Math.max(1, page), totalPages);
        const start = (currentPage - 1) * pageSize;
        const end = Math.min(filteredRows.length, start + pageSize);

        for (let r = start; r < end; r++) {
            const tr = document.createElement("tr");
            const row = filteredRows[r];
            for (let i = 0; i < columns.length; i++) {
                const td = document.createElement("td");
                td.textContent = row[i] == null ? "" : String(row[i]);
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
    }

    // Update pagination UI
    if (pager) {
        updatePaginationState(pager, page, totalPages, totalRows, pageSize);
    }

    return { totalPages, totalRows };
}
