/**
 * Date parsing utilities
 * Strict date/datetime parsing with dayjs integration
 */

import dayjs from 'dayjs';

// Date format definitions (internal only)
const DATE_FORMATS = [
    'DD/MM/YYYY', 'D/M/YYYY',
    'YYYY-MM-DD', 'YYYY/M/D',
    'MM/DD/YYYY', 'M/D/YYYY'
];

const DATETIME_FORMATS = [
    'DD/MM/YYYY HH:mm', 'DD/MM/YYYY HH:mm:ss', 'DD/MM/YYYY HH:mm:ss.SSS',
    'DD/MM/YYYY HH:mm:ss.SSS Z',
    'YYYY-MM-DD HH:mm', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm:ss.SSS',
    'YYYY-MM-DDTHH:mm', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.SSS',
    'YYYY-MM-DDTHH:mmZ', 'YYYY-MM-DDTHH:mm:ssZ', 'YYYY-MM-DDTHH:mm:ss.SSSZ'
];

export function hasTimePart(d) {
    return d.getHours() || d.getMinutes() || d.getSeconds() || d.getMilliseconds();
}

// Parse date-only string with strict format validation
export function parseDateOnlyStrict(s) {
    const t = String(s).trim();
    for (const f of DATE_FORMATS) {
        const d = dayjs(t, f, true);
        if (d.isValid()) return d;
    }
    const dISO = dayjs(t, 'YYYY-MM-DD', true);
    if (dISO.isValid()) return dISO;
    return null;
}

// Parse datetime string with strict format validation
export function parseDateTimeStrict(s) {
    const t = String(s).trim();
    for (const f of DATETIME_FORMATS) {
        const d = dayjs(t, f, true);
        if (d.isValid()) return d;
    }
    if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(t)) {
        const dISO = dayjs(t);
        if (dISO.isValid()) return dISO;
    }
    return null;
}

// Parse cell value to milliseconds timestamp
export function parseCellToMs(val, isDateOnly) {
    if (val == null || val === "") return null;
    if (val instanceof Date) {
        const d = dayjs(val);
        return isDateOnly ? d.startOf('day').valueOf() : d.valueOf();
    }
    const s = String(val).trim();
    if (!s) return null;
    const d = isDateOnly ? parseDateOnlyStrict(s) : (parseDateTimeStrict(s) || parseDateOnlyStrict(s));
    return d ? (isDateOnly ? d.startOf('day').valueOf() : d.valueOf()) : null;
}

/**
 * Parse a time string to milliseconds since midnight
 * @param {string|null} timeStr - Time string in HH:mm, HH:mm:ss, or HH:mm:ss.SSS format
 * @returns {number|null} Milliseconds since midnight or null if invalid
 */
export function parseTimeToMs(timeStr) {
    if (timeStr == null) return null;
    const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?$/);
    if (!match) return null;

    const hours = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    const secs = match[3] ? parseInt(match[3], 10) : 0;
    const ms = match[4] ? parseInt(match[4].padEnd(3, '0').slice(0, 3), 10) : 0;

    // Validate ranges
    if (hours > 23 || mins > 59 || secs > 59) return null;

    return (hours * 3600 + mins * 60 + secs) * 1000 + ms;
}

// ============================================================================
// Safe Date Formatting
// ============================================================================

/**
 * Safely format a date value as YYYY-MM-DD string
 * Handles dates before Unix epoch (1970) correctly
 * 
 * @param {Date|number|bigint} v - Date object, epoch milliseconds, or BigInt epoch ms
 * @returns {string|null} Formatted date string or null if invalid
 */
export function formatDateSafe(v) {
    if (v == null) return null;

    let d;
    if (v instanceof Date) {
        d = v;
    } else if (typeof v === 'bigint') {
        d = new Date(Number(v));
    } else if (typeof v === 'number') {
        d = new Date(v);
    } else {
        return null;
    }

    if (isNaN(d.getTime())) return null;

    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');

    // Handle years: pad to 4 digits, preserve negative for BC dates
    const yearStr = y < 0 ? `-${String(Math.abs(y)).padStart(4, '0')}` : String(y).padStart(4, '0');

    return `${yearStr}-${m}-${day}`;
}

/**
 * Safely format a datetime value as YYYY-MM-DD HH:mm:ss.SSS string
 * Handles dates before Unix epoch (1970) correctly
 * 
 * @param {Date|number|bigint} v - Date object, epoch milliseconds, or BigInt epoch ms
 * @returns {string|null} Formatted datetime string or null if invalid
 */
export function formatDateTimeSafe(v) {
    if (v == null) return null;

    let d;
    if (v instanceof Date) {
        d = v;
    } else if (typeof v === 'bigint') {
        d = new Date(Number(v));
    } else if (typeof v === 'number') {
        d = new Date(v);
    } else {
        return null;
    }

    if (isNaN(d.getTime())) return null;

    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');

    // Handle years: pad to 4 digits, preserve negative for BC dates
    const yearStr = y < 0 ? `-${String(Math.abs(y)).padStart(4, '0')}` : String(y).padStart(4, '0');

    return `${yearStr}-${m}-${day} ${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Safely format a time value as HH:mm:ss.SSS string
 * Handles BigInt microseconds (Arrow Time64) and Date objects
 * 
 * @param {Date|number|bigint} v - Date object, milliseconds since midnight, or BigInt microseconds
 * @param {boolean} [isMicroseconds=false] - If true, v is microseconds (for BigInt Arrow Time64)
 * @returns {string|null} Formatted time string or null if invalid
 */
export function formatTimeSafe(v, isMicroseconds = false) {
    if (v == null) return null;

    let totalMs;

    if (v instanceof Date) {
        const hh = String(v.getUTCHours()).padStart(2, '0');
        const mm = String(v.getUTCMinutes()).padStart(2, '0');
        const ss = String(v.getUTCSeconds()).padStart(2, '0');
        const ms = String(v.getUTCMilliseconds()).padStart(3, '0');
        return `${hh}:${mm}:${ss}.${ms}`;
    }

    if (typeof v === 'bigint') {
        // Arrow Time64 values are microseconds since midnight
        totalMs = Math.floor(Number(v) / 1000);
    } else if (typeof v === 'number') {
        totalMs = isMicroseconds ? Math.floor(v / 1000) : Math.floor(v);
    } else {
        return null;
    }

    if (!Number.isFinite(totalMs) || totalMs < 0) return null;

    const hours = Math.floor(totalMs / 3600000) % 24;
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function parseFilterInputToMs(input, isDateOnly, isStart) {
    if (!input) return null;
    const d = isDateOnly ? parseDateOnlyStrict(input) : (parseDateTimeStrict(input) || parseDateOnlyStrict(input));
    if (!d) return null;
    return isDateOnly ? (isStart ? d.startOf('day').valueOf() : d.endOf('day').valueOf()) : d.valueOf();
}

/**
 * Safely format a Date object as date-only or datetime based on whether it has time component
 * @param {Date} d - Date object
 * @returns {string|null} Formatted date or datetime string
 */
export function formatDateAuto(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    return hasTimePart(d) ? formatDateTimeSafe(d) : formatDateSafe(d);
}

// ============================================================================
// Arrow-Aware Value Formatting
// ============================================================================

/**
 * Arrow Date32 values are stored as days since Unix epoch (1970-01-01)
 * This constant is milliseconds per day for conversion
 */
const MS_PER_DAY = 86400000;

/**
 * Threshold to distinguish Arrow Date32 (small int = days) from milliseconds
 * Dates before 1900 or after 2200 will be treated as milliseconds
 * Range: roughly year 1697 to year 2243 as days
 */
const DATE32_MIN_DAYS = -100000;
const DATE32_MAX_DAYS = 100000;

/**
 * Format a value from Arrow DATE column
 * Handles both BigInt (days since epoch) and Date objects
 * 
 * @param {bigint|number|Date} v - Value from Arrow column
 * @returns {string|null} Formatted date string YYYY-MM-DD or null if invalid
 */
export function formatArrowDate(v) {
    if (v == null) return null;

    // Handle BigInt - Arrow Date32 returns days since epoch as BigInt
    if (typeof v === 'bigint') {
        const days = Number(v);
        if (!Number.isFinite(days)) return String(v);
        return formatDateSafe(days * MS_PER_DAY);
    }

    // Handle Date objects directly
    if (v instanceof Date) {
        return formatDateSafe(v);
    }

    // Handle number - could be days (Date32) or milliseconds
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return null;

        // Heuristic: if the value is in a reasonable "days since epoch" range, treat as days
        // Otherwise treat as milliseconds
        if (v >= DATE32_MIN_DAYS && v <= DATE32_MAX_DAYS && Number.isInteger(v)) {
            return formatDateSafe(v * MS_PER_DAY);
        }
        // Treat as milliseconds
        return formatDateSafe(v);
    }

    return null;
}

/**
 * Format a value from Arrow TIMESTAMP column
 * Handles BigInt (microseconds since epoch), numbers (milliseconds), and Date objects
 * 
 * @param {bigint|number|Date} v - Value from Arrow column
 * @returns {string|null} Formatted datetime string YYYY-MM-DD HH:mm:ss.SSS or null if invalid
 */
export function formatArrowTimestamp(v) {
    if (v == null) return null;

    // Handle BigInt - Arrow Timestamp returns microseconds since epoch as BigInt
    if (typeof v === 'bigint') {
        // Convert microseconds to milliseconds
        const ms = Number(v) / 1000;
        if (!Number.isFinite(ms)) return String(v);
        return formatDateTimeSafe(ms);
    }

    // Handle Date objects directly
    if (v instanceof Date) {
        return formatDateTimeSafe(v);
    }

    // Handle number - typically milliseconds since epoch
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return null;
        return formatDateTimeSafe(v);
    }

    return null;
}

/**
 * Format a value from Arrow TIME column
 * Handles BigInt (microseconds since midnight), numbers (milliseconds), and Date objects
 * 
 * @param {bigint|number|Date} v - Value from Arrow column
 * @returns {string|null} Formatted time string HH:mm:ss.SSS or null if invalid
 */
export function formatArrowTime(v) {
    if (v == null) return null;

    // Handle BigInt - Arrow Time64 returns microseconds since midnight as BigInt
    if (typeof v === 'bigint') {
        return formatTimeSafe(v, true); // isMicroseconds = true for BigInt
    }

    // Handle Date objects and numbers
    return formatTimeSafe(v, false);
}

/**
 * Universal value-to-display-string formatter
 * Converts any Arrow or JS value to a human-readable display string based on SQL type
 * 
 * This is the main entry point for formatting raw values for display.
 * 
 * @param {*} value - Raw value from Arrow column or JavaScript
 * @param {string} sqlType - Normalized SQL type (DATE, TIMESTAMP, TIME, etc.)
 * @returns {string|null} Formatted string for display or null if value is null
 */
export function formatValueForDisplay(value, sqlType) {
    if (value == null) return null;

    const type = String(sqlType).toUpperCase();

    // DATE type
    if (type === 'DATE') {
        const result = formatArrowDate(value);
        if (result) return result;
        // Fallback for string values that are already dates
        if (typeof value === 'string') return value;
        return String(value);
    }

    // TIMESTAMP types
    if (type === 'TIMESTAMP' || type === 'TIMESTAMPTZ') {
        const result = formatArrowTimestamp(value);
        if (result) return result;
        if (typeof value === 'string') return value;
        return String(value);
    }

    // TIME types
    if (type === 'TIME' || type === 'TIMETZ') {
        const result = formatArrowTime(value);
        if (result) return result;
        if (typeof value === 'string') return value;
        return String(value);
    }

    // INTERVAL - always string passthrough
    if (type === 'INTERVAL') {
        return String(value);
    }

    // BigInt values (from HUGEINT, UBIGINT, etc.) - convert to string to preserve precision
    if (typeof value === 'bigint') {
        return String(value);
    }

    // Objects (could be JSON or other complex types)
    if (typeof value === 'object' && value !== null) {
        if (value instanceof Date) {
            // Date object without type hint - use auto detection
            return formatDateAuto(value) || String(value);
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    // Everything else - pass through
    return value;
}
