/**
 * Type inference and coercion utilities
 * Automatic type detection and data type conversion for CSV/Excel imports
 * Note: Uses dayjs globally (via script tag) similar to date-parsing.js
 */

import {
    hasTimePart,
    parseDateOnlyStrict,
    parseDateTimeStrict,
    formatDateSafe,
    formatDateTimeSafe,
    formatTimeSafe,
    formatDateAuto,
    formatArrowDate,
    formatArrowTimestamp,
    formatArrowTime
} from './date-parsing.js';
import {
    normalizeTypeName,
    getIntegerRange,
    isBooleanString,
    parseBooleanString
} from './types.js';

// ============================================================================
// Type Detection Helpers
// ============================================================================

export function isIntString(s) {
    return /^-?\d+$/.test(String(s).trim());
}

export function isRealString(s) {
    return /^-?\d+(?:\.\d+)?(?:e[+\-]?\d+)?$/i.test(String(s).trim());
}



// ============================================================================
// Type Inference From Sample Data
// ============================================================================

/**
 * Infer SQL types from sample rows
 * @param {Array<string>} headers - Column headers
 * @param {Array<Array>} sampleRows - Sample data rows
 * @returns {Array<string>} Array of DuckDB type names
 */
export function inferTypesFromSample(headers, sampleRows) {
    const n = headers.length;
    const score = headers.map(() => ({
        int: 0,
        bigint: 0,
        double: 0,
        date: 0,
        datetime: 0,
        boolean: 0,
        text: 0
    }));
    const maxSample = Math.min(sampleRows.length, 2000);

    for (let rowIdx = 0; rowIdx < maxSample; rowIdx++) {
        const row = sampleRows[rowIdx];
        for (let i = 0; i < n; i++) {
            const v = row[i];
            if (v == null || v === "") continue;

            // Handle Date objects
            if (v instanceof Date) {
                hasTimePart(v) ? score[i].datetime++ : score[i].date++;
                continue;
            }

            // Handle numbers
            if (typeof v === "number") {
                if (Math.abs(v) > Number.MAX_SAFE_INTEGER) {
                    score[i].text += 10;
                    continue;
                }
                if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) {
                    score[i].int++;
                } else if (Number.isInteger(v)) {
                    score[i].bigint++;
                } else {
                    score[i].double++;
                }
                continue;
            }

            // Handle booleans
            if (typeof v === "boolean") {
                score[i].boolean++;
                continue;
            }

            // Handle strings
            const s = String(v).trim();
            if (!s) continue;

            // Check for boolean strings (use centralized constants)
            const lowerS = s.toLowerCase();
            if (isBooleanString(lowerS)) {
                score[i].boolean++;
                continue;
            }

            // Check for datetime
            const dt = parseDateTimeStrict(s);
            if (dt) {
                score[i].datetime++;
                continue;
            }

            // Check for date
            const d = parseDateOnlyStrict(s);
            if (d) {
                score[i].date++;
                continue;
            }

            // Check for integer
            if (isIntString(s)) {
                const num = parseInt(s, 10);
                if (num >= -2147483648 && num <= 2147483647) {
                    score[i].int++;
                } else {
                    score[i].bigint++;
                }
                continue;
            }

            // Check for real number
            if (isRealString(s)) {
                score[i].double++;
                continue;
            }

            // Default to text
            score[i].text++;
        }
    }

    // Determine final types based on scores
    const types = new Array(n).fill("VARCHAR");
    for (let i = 0; i < n; i++) {
        const s = score[i];
        const total = s.int + s.bigint + s.double + s.date + s.datetime + s.boolean + s.text;

        // If more than 10% text, default to VARCHAR
        if (s.text > total * 0.1) {
            types[i] = "VARCHAR";
            continue;
        }

        // Priority order for type selection
        if (s.datetime > 0) types[i] = "TIMESTAMP";
        else if (s.date > 0) types[i] = "DATE";
        else if (s.boolean > total * 0.5) types[i] = "BOOLEAN";
        else if (s.double > 0) types[i] = "DOUBLE";
        else if (s.bigint > 0) types[i] = "BIGINT";
        else if (s.int > 0) types[i] = "INTEGER";
        else types[i] = "VARCHAR";
    }

    return types;
}

// ============================================================================
// BigInt Safe Conversion
// ============================================================================

const MIN_SAFE_BI = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BI = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Convert a string to a safe integer or keep as string if too large
 * @param {string} s - String representation of integer
 * @returns {number|string} Number if safe, original string if too large
 */
function toSafeIntOrString(s) {
    try {
        const b = BigInt(s);
        if (b < MIN_SAFE_BI || b > MAX_SAFE_BI) return s;
        return Number(s);
    } catch {
        return s;
    }
}

// ============================================================================
// Value Coercion
// ============================================================================

/**
 * Coerce a value to a specified SQL type
 * Handles conversion from various JavaScript types to DuckDB-compatible values
 * 
 * @param {*} v - Value to coerce
 * @param {string} t - Target DuckDB type
 * @param {string} [sourceType] - Optional source type for better conversion (e.g., DATE vs TIMESTAMP)
 * @returns {*} Coerced value
 */
export function coerceToType(v, t, sourceType = null) {
    if (v == null || v === "") return null;

    const typeUpper = normalizeTypeName(t);
    const srcUpper = sourceType ? normalizeTypeName(sourceType) : null;

    // VARCHAR / TEXT types
    if (typeUpper === "VARCHAR") {
        // Handle Date objects
        if (v instanceof Date) {
            // Use source type hint if available, otherwise check for time part
            if (srcUpper === "DATE") {
                return formatDateSafe(v) || String(v);
            } else if (srcUpper === "TIMESTAMP" || srcUpper === "TIMESTAMPTZ") {
                return formatDateTimeSafe(v) || String(v);
            } else if (srcUpper === "TIME" || srcUpper === "TIMETZ") {
                return formatTimeSafe(v) || String(v);
            }
            // No source type hint - infer from value
            return formatDateAuto(v) || String(v);
        }

        // Handle BigInt (common from Arrow Date32/Timestamp/Time64/Decimal columns)
        // Use Arrow-aware formatting functions for proper conversion
        if (typeof v === "bigint") {
            // ONLY convert BigInt to date format if we have an explicit source type hint
            // Without a source type hint, BigInt values should remain as strings
            if (srcUpper === "DATE") {
                const result = formatArrowDate(v);
                if (result) return result;
            } else if (srcUpper === "TIMESTAMP" || srcUpper === "TIMESTAMPTZ") {
                const result = formatArrowTimestamp(v);
                if (result) return result;
            } else if (srcUpper === "TIME" || srcUpper === "TIMETZ") {
                const result = formatArrowTime(v);
                if (result) return result;
            }
            // No source type hint or formatting failed - return as string
            return String(v);
        }

        // Handle numeric values (from Arrow columns or JavaScript Date.getTime())
        // ONLY convert to date format if we have an explicit source type hint
        // This prevents ID values like 2, 3 from becoming "1970-01-01 00:00:00.002"
        if (typeof v === "number" && Number.isFinite(v)) {
            if (srcUpper === "DATE") {
                const result = formatArrowDate(v);
                if (result) return result;
            } else if (srcUpper === "TIMESTAMP" || srcUpper === "TIMESTAMPTZ") {
                const result = formatArrowTimestamp(v);
                if (result) return result;
            } else if (srcUpper === "TIME" || srcUpper === "TIMETZ") {
                const result = formatArrowTime(v);
                if (result) return result;
            }
            // No source type hint - don't interpret as date/timestamp
        }

        // Handle objects (JSON stringify)
        if (typeof v === "object" && v !== null) {
            try {
                return JSON.stringify(v);
            } catch {
                return String(v);
            }
        }

        return String(v);
    }

    // Integer types - TINYINT, SMALLINT, INTEGER
    if (typeUpper === "TINYINT" || typeUpper === "SMALLINT" || typeUpper === "INTEGER") {
        const range = getIntegerRange(typeUpper);

        if (v instanceof Date) return Math.trunc(v.getTime() / 1000);

        if (typeof v === "number") {
            const truncated = Math.trunc(v);
            if (range && truncated >= range.min && truncated <= range.max) {
                return truncated;
            }
            return v; // Return original if out of range
        }

        if (typeof v === "string") {
            const trimmed = v.trim();
            if (!isIntString(trimmed)) return trimmed;
            const num = parseInt(trimmed, 10);
            if (range && num >= range.min && num <= range.max) {
                return num;
            }
            return trimmed; // Return string if out of range
        }

        return v;
    }

    // Unsigned integer types - UTINYINT, USMALLINT, UINTEGER
    if (typeUpper === "UTINYINT" || typeUpper === "USMALLINT" || typeUpper === "UINTEGER") {
        const range = getIntegerRange(typeUpper);

        if (v instanceof Date) return Math.abs(Math.trunc(v.getTime() / 1000));

        if (typeof v === "number") {
            const truncated = Math.abs(Math.trunc(v));
            if (range && truncated >= range.min && truncated <= range.max) {
                return truncated;
            }
            return v;
        }

        if (typeof v === "string") {
            const trimmed = v.trim();
            if (!isIntString(trimmed)) return trimmed;
            const num = Math.abs(parseInt(trimmed, 10));
            if (range && num >= range.min && num <= range.max) {
                return num;
            }
            return trimmed;
        }

        return v;
    }

    // BIGINT
    if (typeUpper === "BIGINT") {
        if (v instanceof Date) return Math.trunc(v.getTime());
        if (typeof v === "number") return Math.trunc(v);
        if (typeof v === "string") {
            const trimmed = v.trim();
            return isIntString(trimmed) ? toSafeIntOrString(trimmed) : trimmed;
        }
        return v;
    }

    // UBIGINT
    if (typeUpper === "UBIGINT") {
        if (v instanceof Date) return Math.abs(Math.trunc(v.getTime()));
        if (typeof v === "number") return Math.abs(Math.trunc(v));
        if (typeof v === "string") {
            const trimmed = v.trim();
            if (!isIntString(trimmed)) return trimmed;
            const result = toSafeIntOrString(trimmed);
            return typeof result === "number" ? Math.abs(result) : trimmed;
        }
        return v;
    }

    // HUGEINT / UHUGEINT - These exceed JS precision, keep as strings
    if (typeUpper === "HUGEINT" || typeUpper === "UHUGEINT") {
        if (v instanceof Date) return String(v.getTime());
        if (typeof v === "number") return String(Math.trunc(v));
        if (typeof v === "string") return v.trim();
        return String(v);
    }

    // Floating-point types - DOUBLE, REAL, FLOAT, DECIMAL
    if (typeUpper === "DOUBLE" || typeUpper === "REAL" || typeUpper === "DECIMAL") {
        if (v instanceof Date) return v.getTime();
        if (typeof v === "number") return v;
        if (typeof v === "string") {
            const trimmed = v.trim();
            return isRealString(trimmed) ? parseFloat(trimmed) : trimmed;
        }
        return v;
    }

    // DATE
    if (typeUpper === "DATE") {
        if (v instanceof Date) return formatDateSafe(v) || String(v);
        if (typeof v === "number") {
            return formatDateSafe(v) || String(v);
        }
        if (typeof v === "string") {
            const trimmed = v.trim();
            const d = parseDateOnlyStrict(trimmed);
            return d ? d.format("YYYY-MM-DD") : trimmed;
        }
        return v;
    }

    // TIMESTAMP / TIMESTAMPTZ
    if (typeUpper === "TIMESTAMP" || typeUpper === "TIMESTAMPTZ") {
        if (v instanceof Date) return formatDateTimeSafe(v) || String(v);
        if (typeof v === "number") {
            return formatDateTimeSafe(v) || String(v);
        }
        if (typeof v === "string") {
            const trimmed = v.trim();
            const d = parseDateTimeStrict(trimmed) || parseDateOnlyStrict(trimmed);
            return d ? d.format("YYYY-MM-DD HH:mm:ss.SSS") : trimmed;
        }
        return v;
    }

    // TIME / TIMETZ
    if (typeUpper === "TIME" || typeUpper === "TIMETZ") {
        if (v instanceof Date) return formatTimeSafe(v) || String(v);
        if (typeof v === "string") return v.trim();
        return String(v);
    }

    // INTERVAL - Pass through as string
    if (typeUpper === "INTERVAL") {
        if (typeof v === "string") return v.trim();
        if (typeof v === "object" && v !== null) {
            // Handle interval objects if they have a toString
            return String(v);
        }
        return String(v);
    }

    // BOOLEAN (use centralized boolean constants for consistency)
    if (typeUpper === "BOOLEAN") {
        if (typeof v === "boolean") return v;
        if (typeof v === "string") {
            const lower = v.toLowerCase().trim();
            const parsed = parseBooleanString(lower);
            if (parsed !== null) return parsed;
        }
        if (typeof v === "number") return v !== 0;
        return v;
    }

    // UUID - Validate and pass through
    if (typeUpper === "UUID") {
        if (typeof v === "string") {
            const trimmed = v.trim();
            // Return as-is, DuckDB will validate
            return trimmed;
        }
        return String(v);
    }

    // JSON - Stringify objects, pass through strings
    if (typeUpper === "JSON") {
        if (typeof v === "string") {
            // Assume it's already JSON
            return v;
        }
        if (typeof v === "object" && v !== null) {
            try {
                return JSON.stringify(v);
            } catch {
                return String(v);
            }
        }
        return String(v);
    }

    // BLOB / BIT - Pass through
    if (typeUpper === "BLOB" || typeUpper === "BIT") {
        return v;
    }

    // Default: return as-is
    return v;
}
