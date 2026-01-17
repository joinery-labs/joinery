/**
 * Type Detection and Formatting
 * Handles column type detection and cell value formatting.
 */

import {
    hasTimePart,
    formatValueForDisplay
} from '../../utils/date-parsing.js';

import {
    normalizeTypeName,
    getDisplayCategory,
    DisplayTypeCategory
} from '../../utils/types.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Format a cell value based on its type string.
 * 
 * @param {*} val - Cell value
 * @param {string} typeStr - Type string from schema
 * @returns {*} Formatted value
 */
export function formatCellValue(val, typeStr) {
    if (val == null) return val;

    const normalized = normalizeTypeName(typeStr);

    // Use centralized formatValueForDisplay for date/time types
    // Handles BigInt, Date, number consistently
    if (normalized === "DATE" ||
        normalized === "TIMESTAMP" || normalized === "TIMESTAMPTZ" ||
        normalized === "TIME" || normalized === "TIMETZ" ||
        normalized === "INTERVAL") {
        return formatValueForDisplay(val, normalized);
    }

    // Handle BigInt for numeric types - convert to string to preserve precision
    if (typeof val === "bigint") {
        return String(val);
    }

    // Handle Date objects that don't have a type hint
    if (val instanceof Date) {
        return formatValueForDisplay(val, hasTimePart(val) ? "TIMESTAMP" : "DATE");
    }

    // Handle objects (JSON, etc.)
    if (typeof val === "object" && val !== null) {
        try {
            return JSON.stringify(val);
        } catch {
            return String(val);
        }
    }

    return val;
}

/**
 * Detect column types from schema type strings.
 * Uses centralized getDisplayCategory for O(1) lookup.
 * 
 * @param {Array<string>} schemaTypes - Array of schema type strings from DuckDB
 * @param {number} count - Number of columns
 * @returns {Array<string>} Array of type strings: 'text', 'number', 'date', 'time', 'datetime', 'boolean'
 */
export function detectColumnTypesFromSchema(schemaTypes, count) {
    const out = new Array(count).fill("text");
    if (!Array.isArray(schemaTypes)) return out;

    for (let i = 0; i < count; i++) {
        const rawType = schemaTypes[i];
        if (!rawType) {
            out[i] = "text";
            continue;
        }

        // Use centralized display category for accurate detection (O(1) lookup)
        const category = getDisplayCategory(rawType);

        switch (category) {
            case DisplayTypeCategory.NUMBER:
                out[i] = "number";
                break;
            case DisplayTypeCategory.DATE:
                out[i] = "date";
                break;
            case DisplayTypeCategory.TIME:
                out[i] = "time";
                break;
            case DisplayTypeCategory.DATETIME:
                out[i] = "datetime";
                break;
            case DisplayTypeCategory.BOOLEAN:
                out[i] = "boolean";
                break;
            case DisplayTypeCategory.BINARY:
            case DisplayTypeCategory.TEXT:
            case DisplayTypeCategory.OTHER:
            default:
                out[i] = "text";
                break;
        }
    }

    return out;
}
