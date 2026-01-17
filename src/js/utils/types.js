/**
 * Centralized Type Constants and Utilities
 * Single source of truth for DuckDB type handling across the application
 */

// ============================================================================
// Type Constants
// ============================================================================

/**
 * Comprehensive list of DuckDB data types for column type selection.
 * Organized by category for clarity. These are the canonical type names.
 */
export const DUCKDB_TYPES = Object.freeze([
    // Integer types (signed)
    "TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT",
    // Integer types (unsigned)
    "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "UHUGEINT",
    // Floating-point types
    "REAL", "DOUBLE", "DECIMAL",
    // Text types
    "VARCHAR",
    // Boolean
    "BOOLEAN",
    // Date/Time types
    "DATE", "TIME", "TIMETZ", "TIMESTAMP", "TIMESTAMPTZ", "INTERVAL",
    // Binary types
    "BLOB", "BIT",
    // Special types
    "UUID", "JSON"
]);

/**
 * Set for O(1) lookup of supported types
 */
export const DUCKDB_TYPES_SET = new Set(DUCKDB_TYPES);

// Boolean string patterns for internal type detection
// Used by isBooleanString, parseBooleanString, and valueAsBoolean
const BOOLEAN_TRUE_STRINGS = Object.freeze(['true', 't', '1', 'yes', 'y']);
const BOOLEAN_FALSE_STRINGS = Object.freeze(['false', 'f', '0', 'no', 'n']);
const BOOLEAN_ALL_STRINGS = Object.freeze([...BOOLEAN_TRUE_STRINGS, ...BOOLEAN_FALSE_STRINGS]);

/**
 * Check if a string represents a boolean value
 * @param {string} s - String to check (should be lowercase and trimmed)
 * @returns {boolean}
 */
export function isBooleanString(s) {
    return BOOLEAN_ALL_STRINGS.includes(s);
}

/**
 * Parse a boolean string to a boolean value
 * @param {string} s - String to parse (should be lowercase and trimmed)
 * @returns {boolean|null} Boolean value or null if not a boolean string
 */
export function parseBooleanString(s) {
    if (BOOLEAN_TRUE_STRINGS.includes(s)) return true;
    if (BOOLEAN_FALSE_STRINGS.includes(s)) return false;
    return null;
}

/**
 * TreeSelect data pre-computed from DUCKDB_TYPES for UI components
 */
export const TYPE_SELECT_DATA = Object.freeze(
    DUCKDB_TYPES.map(t => ({ id: t, label: t }))
);

// ============================================================================
// Type Aliases
// ============================================================================

const TYPE_ALIASES = Object.freeze({
    // Integer aliases
    "INT": "INTEGER",
    "INT4": "INTEGER",
    "INT8": "BIGINT",
    "INT2": "SMALLINT",
    "INT1": "TINYINT",
    "LONG": "BIGINT",
    "SHORT": "SMALLINT",
    "SIGNED": "INTEGER",
    "INT128": "HUGEINT",
    // Unsigned aliases
    "UINT1": "UTINYINT",
    "UINT2": "USMALLINT",
    "UINT4": "UINTEGER",
    "UINT8": "UBIGINT",
    "UINT128": "UHUGEINT",
    // Float aliases
    "FLOAT": "REAL",
    "FLOAT4": "REAL",
    "FLOAT8": "DOUBLE",
    "NUMERIC": "DECIMAL",
    // Text aliases
    "TEXT": "VARCHAR",
    "STRING": "VARCHAR",
    "CHAR": "VARCHAR",
    "BPCHAR": "VARCHAR",
    "NVARCHAR": "VARCHAR",
    // Boolean aliases
    "BOOL": "BOOLEAN",
    "LOGICAL": "BOOLEAN",
    // Date/Time aliases
    "DATETIME": "TIMESTAMP",
    "TIMESTAMP WITHOUT TIME ZONE": "TIMESTAMP",
    "TIMESTAMP WITH TIME ZONE": "TIMESTAMPTZ",
    "TIME WITHOUT TIME ZONE": "TIME",
    "TIME WITH TIME ZONE": "TIMETZ",
    // Binary aliases
    "BYTEA": "BLOB",
    "BINARY": "BLOB",
    "VARBINARY": "BLOB"
});

// ============================================================================
// Type Category Helpers
// ============================================================================

/**
 * Integer type names (signed and unsigned)
 */
const INTEGER_TYPES = new Set([
    "TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT",
    "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "UHUGEINT"
]);

/**
 * Floating-point type names
 */
const FLOAT_TYPES = new Set(["REAL", "DOUBLE", "DECIMAL"]);

/**
 * Date/Time type names
 */
const DATETIME_TYPES = new Set(["DATE", "TIME", "TIMETZ", "TIMESTAMP", "TIMESTAMPTZ", "INTERVAL"]);

/**
 * Check if type is an integer type (signed or unsigned)
 * @param {string} type - Type name (will be normalized)
 * @returns {boolean}
 */
export function isIntegerType(type) {
    const normalized = normalizeTypeName(type);
    return INTEGER_TYPES.has(normalized);
}

/**
 * Check if type is a floating-point type
 * @param {string} type - Type name (will be normalized)
 * @returns {boolean}
 */
export function isFloatType(type) {
    const normalized = normalizeTypeName(type);
    // normalizeTypeName already strips parameters like DECIMAL(10,2) -> DECIMAL
    return FLOAT_TYPES.has(normalized);
}

/**
 * Check if type is a date-only type (no time component)
 * @param {string} type - Type name (will be normalized)
 * @returns {boolean}
 */

export function isDateOnlyType(type) {
    return normalizeTypeName(type) === "DATE";
}

/**
 * Check if type is a time-only type (no date component)
 * @param {string} type - Type name (will be normalized)
 * @returns {boolean}
 */
export function isTimeOnlyType(type) {
    const normalized = normalizeTypeName(type);
    return normalized === "TIME" || normalized === "TIMETZ";
}

/**
 * Check if type is a timestamp type (has both date and time)
 * @param {string} type - Type name (will be normalized)
 * @returns {boolean}
 */
export function isTimestampType(type) {
    const normalized = normalizeTypeName(type);
    return normalized === "TIMESTAMP" || normalized === "TIMESTAMPTZ";
}

/**
 * Check if type is a boolean type
 * @param {string} type - Type name (will be normalized)
 * @returns {boolean}
 */
export function isBooleanType(type) {
    return normalizeTypeName(type) === "BOOLEAN";
}



// ============================================================================
// Type Normalization
// ============================================================================

/**
 * Normalize type name for comparison and selection.
 * - Handles Arrow type notation (e.g., Date32[day] -> DATE, Timestamp[us] -> TIMESTAMP)
 * - Strips parameters from parameterized types (e.g., VARCHAR(255) -> VARCHAR)
 * - Converts aliases to canonical names (e.g., INT -> INTEGER, BOOL -> BOOLEAN)
 * - Handles "WITH TIME ZONE" suffix for timestamp/time types
 * 
 * @param {string} type - Type name from DuckDB or Arrow schema
 * @returns {string} Normalized canonical type name (uppercase)
 */
export function normalizeTypeName(type) {
    if (!type) return "VARCHAR";

    let normalized = String(type).toUpperCase().trim();

    // =========================================================================
    // Handle Arrow type notation (returned by DuckDB-WASM Arrow schema)
    // =========================================================================

    // Date types: Date32[day], Date64[ms], DateDay, DateMillisecond
    if (normalized.startsWith("DATE32") || normalized.startsWith("DATE64") ||
        normalized === "DATEDAY" || normalized === "DATEMILLISECOND") {
        return "DATE";
    }

    // Timestamp types: Timestamp[us], Timestamp[us, tz=UTC], Timestamp[ns]
    if (normalized.startsWith("TIMESTAMP[") || normalized.startsWith("TIMESTAMP<")) {
        // Check for timezone
        if (normalized.includes("TZ=") || normalized.includes("TZ =")) {
            return "TIMESTAMPTZ";
        }
        return "TIMESTAMP";
    }

    // Time types: Time32[ms], Time32[s], Time64[us], Time64[ns]
    if (normalized.startsWith("TIME32") || normalized.startsWith("TIME64")) {
        return "TIME";
    }

    // Integer types in Arrow notation
    if (normalized === "INT8") return "TINYINT";
    if (normalized === "INT16") return "SMALLINT";
    if (normalized === "INT32") return "INTEGER";
    if (normalized === "INT64") return "BIGINT";
    if (normalized === "UINT8") return "UTINYINT";
    if (normalized === "UINT16") return "USMALLINT";
    if (normalized === "UINT32") return "UINTEGER";
    if (normalized === "UINT64") return "UBIGINT";

    // Float types in Arrow notation
    if (normalized === "FLOAT16" || normalized === "FLOAT32" || normalized === "FLOAT") return "REAL";
    if (normalized === "FLOAT64") return "DOUBLE";

    // String types in Arrow notation
    if (normalized === "UTF8" || normalized === "LARGEUTF8" || normalized === "STRING") return "VARCHAR";

    // Boolean in Arrow notation
    if (normalized === "BOOL") return "BOOLEAN";

    // Binary types in Arrow notation
    if (normalized === "BINARY" || normalized === "LARGEBINARY") return "BLOB";

    // Duration/Interval in Arrow notation
    if (normalized.startsWith("DURATION") || normalized.startsWith("INTERVAL")) {
        return "INTERVAL";
    }

    // =========================================================================
    // Handle standard DuckDB/SQL type notation
    // =========================================================================

    // Handle "WITH TIME ZONE" suffix before stripping parameters
    if (normalized.startsWith("TIMESTAMP")) {
        if (normalized.includes("WITH TIME ZONE")) return "TIMESTAMPTZ";
        // Strip any parameters
        const parenIndex = normalized.indexOf('(');
        return parenIndex > 0 ? "TIMESTAMP" : "TIMESTAMP";
    }

    if (normalized.startsWith("TIME")) {
        if (normalized.includes("WITH TIME ZONE")) return "TIMETZ";
        if (normalized === "TIME" || normalized.startsWith("TIME(")) return "TIME";
    }

    // Strip parameters from parameterized types (e.g., VARCHAR(255), DECIMAL(10,2))
    const parenIndex = normalized.indexOf('(');
    if (parenIndex > 0) {
        normalized = normalized.substring(0, parenIndex);
    }

    // Strip bracket notation (e.g., Decimal128[38, 10])
    const bracketIndex = normalized.indexOf('[');
    if (bracketIndex > 0) {
        normalized = normalized.substring(0, bracketIndex);
    }

    // Apply alias mapping
    if (TYPE_ALIASES[normalized]) {
        return TYPE_ALIASES[normalized];
    }

    // Check if it's already a valid canonical type
    if (DUCKDB_TYPES_SET.has(normalized)) {
        return normalized;
    }

    // Default to VARCHAR for unknown types
    return "VARCHAR";
}

// ============================================================================
// Display Type Mapping
// ============================================================================

/**
 * Display type categories for UI purposes
 * These are simplified categories for filtering, sorting, and display
 */
export const DisplayTypeCategory = Object.freeze({
    TEXT: "text",
    NUMBER: "number",
    DATE: "date",
    TIME: "time",
    DATETIME: "datetime",
    BOOLEAN: "boolean",
    BINARY: "binary",
    OTHER: "other"
});

/**
 * Pre-computed mapping from normalized SQL types to display categories
 * O(1) lookup instead of sequential checks
 */
const SQL_TYPE_TO_DISPLAY = Object.freeze({
    // Integer types -> NUMBER
    TINYINT: DisplayTypeCategory.NUMBER,
    SMALLINT: DisplayTypeCategory.NUMBER,
    INTEGER: DisplayTypeCategory.NUMBER,
    BIGINT: DisplayTypeCategory.NUMBER,
    HUGEINT: DisplayTypeCategory.NUMBER,
    UTINYINT: DisplayTypeCategory.NUMBER,
    USMALLINT: DisplayTypeCategory.NUMBER,
    UINTEGER: DisplayTypeCategory.NUMBER,
    UBIGINT: DisplayTypeCategory.NUMBER,
    UHUGEINT: DisplayTypeCategory.NUMBER,
    // Float types -> NUMBER
    REAL: DisplayTypeCategory.NUMBER,
    DOUBLE: DisplayTypeCategory.NUMBER,
    DECIMAL: DisplayTypeCategory.NUMBER,
    // Text types -> TEXT
    VARCHAR: DisplayTypeCategory.TEXT,
    UUID: DisplayTypeCategory.TEXT,
    JSON: DisplayTypeCategory.TEXT,
    INTERVAL: DisplayTypeCategory.TEXT,
    // Date/Time types
    DATE: DisplayTypeCategory.DATE,
    TIME: DisplayTypeCategory.TIME,
    TIMETZ: DisplayTypeCategory.TIME,
    TIMESTAMP: DisplayTypeCategory.DATETIME,
    TIMESTAMPTZ: DisplayTypeCategory.DATETIME,
    // Boolean
    BOOLEAN: DisplayTypeCategory.BOOLEAN,
    // Binary types
    BLOB: DisplayTypeCategory.BINARY,
    BIT: DisplayTypeCategory.BINARY
});

/**
 * Get display category for a DuckDB type
 * Uses O(1) lookup for performance
 * @param {string} type - DuckDB type name
 * @returns {string} Display category (text, number, date, time, datetime, boolean, binary, other)
 */
export function getDisplayCategory(type) {
    const normalized = normalizeTypeName(type);
    return SQL_TYPE_TO_DISPLAY[normalized] || DisplayTypeCategory.OTHER;
}

// ============================================================================
// Type Range Constants
// ============================================================================

/**
 * Integer type ranges for validation (internal use only)
 */
const IntegerRanges = Object.freeze({
    TINYINT: { min: -128, max: 127 },
    UTINYINT: { min: 0, max: 255 },
    SMALLINT: { min: -32768, max: 32767 },
    USMALLINT: { min: 0, max: 65535 },
    INTEGER: { min: -2147483648, max: 2147483647 },
    UINTEGER: { min: 0, max: 4294967295 },
    BIGINT: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
    UBIGINT: { min: 0, max: Number.MAX_SAFE_INTEGER },
    // HUGEINT and UHUGEINT exceed JS number precision, handle as strings
    HUGEINT: { min: null, max: null },
    UHUGEINT: { min: null, max: null }
});

/**
 * Get the integer range for a type
 * @param {string} type - Integer type name
 * @returns {{min: number|null, max: number|null}|null} Range object or null if not an integer type
 */
export function getIntegerRange(type) {
    const normalized = normalizeTypeName(type);
    return IntegerRanges[normalized] || null;
}

// ============================================================================
// Value Conversion Utilities
// ============================================================================

/**
 * Convert a value to a number if possible
 * Handles strings, numbers, and BigInt
 * Centralized to avoid duplication across modules
 * 
 * @param {*} x - Value to convert
 * @returns {number|null} Number value or null if not convertible
 */
export function valueAsNumber(x) {
    if (x == null || x === "") return null;
    if (typeof x === "bigint") {
        const n = Number(x);
        return Number.isFinite(n) ? n : null;
    }
    const n = (typeof x === "number") ? x : parseFloat(String(x));
    return Number.isFinite(n) ? n : null;
}

/**
 * Convert a value to a boolean if possible
 * Handles booleans, numbers, and boolean strings (true/false, yes/no, 1/0, etc.)
 * 
 * @param {*} val - Value to convert
 * @returns {boolean|null} Boolean value or null if not convertible
 */
export function valueAsBoolean(val) {
    if (val == null) return null;
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val !== 0;
    const str = String(val).toLowerCase().trim();
    if (BOOLEAN_TRUE_STRINGS.includes(str)) return true;
    if (BOOLEAN_FALSE_STRINGS.includes(str)) return false;
    return null;
}
