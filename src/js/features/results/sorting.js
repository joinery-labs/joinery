/**
 * Sorting Logic
 * Handles client-side sorting of result rows.
 */

import { parseCellToMs, parseTimeToMs } from '../../utils/date-parsing.js';
import { valueAsNumber } from '../../utils/types.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Create a comparator function for sorting rows
 * @param {number} colIdx - Column index to sort by
 * @param {string} type - Column type ('number', 'date', 'datetime', 'time', or 'text')
 * @param {boolean} ascending - True for ascending sort, false for descending
 * @returns {function} Comparator function for Array.sort()
 */
export function createComparator(colIdx, type, ascending) {
    return (a, b) => {
        const va = a[colIdx];
        const vb = b[colIdx];

        if (type === "number") {
            const na = valueAsNumber(va) ?? -Infinity;
            const nb = valueAsNumber(vb) ?? -Infinity;
            return ascending ? (na - nb) : (nb - na);
        } else if (type === "date" || type === "datetime") {
            const ta = parseCellToMs(va, type === "date") ?? -8640000000000000;
            const tb = parseCellToMs(vb, type === "date") ?? -8640000000000000;
            return ascending ? (ta - tb) : (tb - ta);
        } else if (type === "time") {
            // TIME type - sort by milliseconds since midnight
            // Use -1 as fallback for null/invalid values to sort them last in ascending order
            const ta = parseTimeToMs(va) ?? -1;
            const tb = parseTimeToMs(vb) ?? -1;
            return ascending ? (ta - tb) : (tb - ta);
        } else {
            const sa = String(va ?? "");
            const sb = String(vb ?? "");
            const res = sa.localeCompare(sb);
            return ascending ? res : -res;
        }
    };
}
