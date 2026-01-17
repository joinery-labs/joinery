/**
 * Filtering Logic
 * Handles client-side filtering of result rows.
 */

import {
    parseCellToMs,
    parseFilterInputToMs,
    parseTimeToMs
} from '../../utils/date-parsing.js';
import {
    valueAsNumber,
    valueAsBoolean
} from '../../utils/types.js';


// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Check if a value matches a filter
 * @param {*} val - Cell value to test
 * @param {object} f - Filter definition (type, min/max or from/to or value/op/case)
 * @param {string} type - Column type ('number', 'date', 'datetime', 'time', 'boolean', or 'text')
 * @returns {boolean} True if value matches filter
 */
export function matchesFilter(val, f, type) {
    if (!f) return true;

    if (type === "number") {
        const n = valueAsNumber(val);
        if (n == null) return false;
        if (f.min != null && n < f.min) return false;
        if (f.max != null && n > f.max) return false;
        return true;
    }

    if (type === "date" || type === "datetime") {
        const dms = parseCellToMs(val, type === "date");
        if (dms == null) return false;
        if (f.from) {
            const fromMs = parseFilterInputToMs(f.from, type === "date", true);
            if (fromMs != null && dms < fromMs) return false;
        }
        if (f.to) {
            const toMs = parseFilterInputToMs(f.to, type === "date", false);
            if (toMs != null && dms > toMs) return false;
        }
        return true;
    }

    // TIME type - compare as milliseconds since midnight
    if (type === "time") {
        const timeMs = parseTimeToMs(val);
        if (timeMs == null) return false;
        if (f.from) {
            const fromMs = parseTimeToMs(f.from);
            if (fromMs != null && timeMs < fromMs) return false;
        }
        if (f.to) {
            const toMs = parseTimeToMs(f.to);
            if (toMs != null && timeMs > toMs) return false;
        }
        return true;
    }

    // BOOLEAN type - compare boolean value
    if (type === "boolean") {
        const boolVal = valueAsBoolean(val);
        // If filter value is set, compare
        if (f.value !== undefined && f.value !== null) {
            return boolVal === f.value;
        }
        // No filter value means "any" - match all
        return true;
    }

    // Default: text filter
    const s = val == null ? "" : String(val);
    if (f.op === "equals") {
        return f.case ? s === f.value : s.toLowerCase() === f.value.toLowerCase();
    }
    return f.case ? s.includes(f.value) : s.toLowerCase().includes(f.value.toLowerCase());
}

