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
 * Format a cell value based on its type info.
 * Accepts column metadata objects {name, scale} or type strings.
 * 
 * @param {*} val - Cell value
 * @param {object|string} typeInfo - Column metadata {name, scale} or type string
 * @returns {*} Formatted value
 */
export function formatCellValue(val, typeInfo) {
    if (val == null) return val;

    // Extract normalized type string early - needed for date/time detection
    const normalized = typeInfo ? normalizeTypeName(getTypeString(typeInfo)) : "";

    // Check if this is a date/time type that requires special formatting
    const isDateTimeType = normalized === "DATE" ||
        normalized === "TIMESTAMP" || normalized === "TIMESTAMPTZ" ||
        normalized === "TIME" || normalized === "TIMETZ" ||
        normalized === "INTERVAL";

    // Handle BigInt values (Arrow returns BigInt for large integers and some Decimal types)
    if (typeof val === "bigint") {
        // Decimal types have scale metadata
        if (typeInfo && typeof typeInfo === "object" && typeof typeInfo.scale === "number") {
            return formatDecimalBigInt(val, typeInfo.scale);
        }
        // Date/time BigInt values need formatting
        if (isDateTimeType) {
            return formatValueForDisplay(val, normalized);
        }
        return String(val);
    }

    // Primitives: pass through UNLESS it's a date/time type that needs formatting
    const valType = typeof val;
    if (valType === "number" || valType === "string" || valType === "boolean") {
        // Date/time values stored as numbers/strings need formatting
        if (isDateTimeType) {
            return formatValueForDisplay(val, normalized);
        }
        return val;
    }

    // Handle Decimal objects (non-Date objects with scale metadata)
    if (typeInfo && typeof typeInfo === "object" && typeof typeInfo.scale === "number" &&
        typeof val === "object" && val !== null && !(val instanceof Date)) {
        const unscaled = String(val);
        return formatDecimalString(unscaled, typeInfo.scale);
    }

    // Date objects - use type hint if available, otherwise auto-detect
    if (val instanceof Date) {
        if (normalized === "DATE" || normalized === "TIMESTAMP" || normalized === "TIMESTAMPTZ") {
            return formatValueForDisplay(val, normalized);
        }
        return formatValueForDisplay(val, hasTimePart(val) ? "TIMESTAMP" : "DATE");
    }

    // Remaining date/time types (already handled above for primitives, this catches objects)
    if (isDateTimeType) {
        return formatValueForDisplay(val, normalized);
    }

    // Objects
    if (typeof val === "object") {
        try {
            return JSON.stringify(val);
        } catch {
            return String(val);
        }
    }

    return val;
}

/**
 * Format a BigInt value from Arrow Decimal type with proper decimal placement.
 * Handles any precision and scale combination.
 * 
 * @param {bigint} val - The scaled BigInt value from Arrow Decimal column
 * @param {number} scale - Number of digits after decimal point
 * @returns {string} Formatted decimal string
 */
function formatDecimalBigInt(val, scale) {
    // Guard: scale must be positive and within reasonable bounds (DuckDB max is 38)
    if (scale <= 0 || scale > 100) {
        return String(val);
    }

    const isNegative = val < 0n;
    const absVal = isNegative ? -val : val;
    const str = String(absVal);

    let result;
    if (str.length <= scale) {
        const padded = str.padStart(scale, '0');
        result = '0.' + padded;
    } else {
        const intPart = str.slice(0, -scale);
        const fracPart = str.slice(-scale);
        result = intPart + '.' + fracPart;
    }

    return isNegative ? '-' + result : result;
}

/**
 * Format a string value from Arrow Decimal object with proper decimal placement.
 * Arrow Decimal objects return the unscaled integer as a string from toString().
 * 
 * @param {string} str - The unscaled integer string from Arrow Decimal.toString()
 * @param {number} scale - Number of digits after decimal point
 * @returns {string} Formatted decimal string
 */
function formatDecimalString(str, scale) {
    // Guard: scale must be positive, within bounds, and string must be non-empty
    if (scale <= 0 || scale > 100 || !str) {
        return str || '';
    }

    const isNegative = str.startsWith('-');
    const absStr = isNegative ? str.slice(1) : str;

    let result;
    if (absStr.length <= scale) {
        const padded = absStr.padStart(scale, '0');
        result = '0.' + padded;
    } else {
        const intPart = absStr.slice(0, -scale);
        const fracPart = absStr.slice(-scale);
        result = intPart + '.' + fracPart;
    }

    return isNegative ? '-' + result : result;
}

/**
 * Extract type string from column metadata or pass through string.
 * @param {object|string} typeInfo - Column metadata {name, scale} or type string
 * @returns {string} Type string
 */
function getTypeString(typeInfo) {
    if (typeInfo && typeof typeInfo === "object") {
        // Prefer explicit name property from column metadata
        if (typeof typeInfo.name === "string") {
            return typeInfo.name;
        }
        // Fallback to toString() for other object types
        return typeInfo.toString?.() ?? "";
    }
    return String(typeInfo || "");
}

/**
 * Detect column types from schema types.
 * Accepts column metadata objects {name, scale} or type strings.
 * Uses centralized getDisplayCategory for O(1) lookup.
 * 
 * @param {Array<object|string>} schemaTypes - Array of column metadata {name, scale} or type strings
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

        const typeStr = getTypeString(rawType);

        // Map to display category
        const category = getDisplayCategory(typeStr);

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
