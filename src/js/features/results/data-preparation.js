/**
 * Data Preparation
 * Handles materialization of Arrow data and application of filters/sorting.
 */

import { formatCellValue } from './type-detection.js';
import { matchesFilter } from './filtering.js';
import { createComparator } from './sorting.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Ensure row data is materialized from Arrow table if needed
 * Lazily materializes and caches row data for filtering/sorting
 * 
 * @param {object} resultEntry - Result entry with arrowTable, columnTypes, etc.
 * @param {Array<string>} columns - Column names
 * @returns {Array<Array>} Materialized row values
 */
export function ensureMaterialized(resultEntry, columns) {
    // Return cached values if already materialized
    if (resultEntry.values && Array.isArray(resultEntry.values)) {
        return resultEntry.values;
    }

    // Prevent materialization of large result sets for filters/sorts
    if (!resultEntry.allowClientOps) {
        return [];
    }

    const tbl = resultEntry.arrowTable;
    const rowCount = resultEntry.rowCount || tbl.numRows || 0;
    const colCount = columns.length;
    const colsArr = new Array(colCount);
    for (let j = 0; j < colCount; j++) {
        colsArr[j] = tbl.getChildAt(j);
    }

    const typeArr = resultEntry.columnTypes || [];
    const out = new Array(rowCount);

    for (let i = 0; i < rowCount; i++) {
        const row = new Array(colCount);
        for (let j = 0; j < colCount; j++) {
            const col = colsArr[j];
            let v = col ? col.get(i) : null;
            v = formatCellValue(v, typeArr[j]);
            row[j] = v;
        }
        out[i] = row;
    }

    // Cache for subsequent calls
    resultEntry.values = out;
    return out;
}

/**
 * Get filtered and sorted rows for display
 * @param {object} resultEntry - Result entry
 * @param {Array<string>} columns - Column names
 * @param {Array} filterState - Filter state array
 * @param {Array<string>} colTypes - Column types
 * @param {number} sortCol - Sort column index (-1 if none)
 * @param {boolean} sortAsc - Sort direction
 * @returns {object} {columns, values} - Filtered/sorted data
 */
export function getActiveRows(resultEntry, columns, filterState, colTypes, sortCol, sortAsc) {
    if (!resultEntry) {
        return { columns, values: [] };
    }

    // Large results: avoid materialization
    if (!resultEntry.allowClientOps) {
        return { columns, values: [] };
    }

    const baseRows = ensureMaterialized(resultEntry, columns);
    let rows = baseRows;

    // Apply filters
    rows = rows.filter(row => {
        for (let i = 0; i < columns.length; i++) {
            if (!filterState[i]) continue;
            if (!matchesFilter(row[i], filterState[i], colTypes[i])) return false;
        }
        return true;
    });

    // Apply sorting
    if (sortCol >= 0) {
        const cmp = createComparator(sortCol, colTypes[sortCol], sortAsc);
        rows = rows.slice().sort(cmp);
    }

    return { columns: resultEntry.columns, values: rows };
}
