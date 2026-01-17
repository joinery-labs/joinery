/**
 * Parameter Utilities
 * Functions for handling SQL template parameters with {{param_name}} syntax
 */

// Regex to match {{param_name}} placeholders
const PARAM_REGEX = /\{\{(.+?)\}\}/g;

/**
 * Extract unique parameter names from SQL
 * @param {string} sql - SQL query string
 * @returns {string[]} Array of unique parameter names
 */
export function extractParameters(sql) {
    if (!sql || typeof sql !== 'string') return [];

    const params = [];
    const seen = new Set();

    // Reset regex lastIndex
    PARAM_REGEX.lastIndex = 0;

    let match;
    while ((match = PARAM_REGEX.exec(sql)) !== null) {
        const paramName = match[1].trim(); // Case-sensitive, but trimmed
        if (paramName && !seen.has(paramName)) {
            seen.add(paramName);
            params.push(paramName);
        }
    }

    return params;
}

/**
 * Validate parameters array for issues
 * @param {Array<{name: string, defaultValue?: string}>} params - Parameters to validate
 * @returns {{valid: boolean, error?: string}}
 */
export function validateParameters(params) {
    if (!Array.isArray(params)) {
        return { valid: false, error: 'Parameters must be an array' };
    }

    for (const param of params) {
        if (!param.name || typeof param.name !== 'string') {
            return { valid: false, error: 'Parameter name is required' };
        }

        const nameKey = param.name.trim();

        if (!nameKey) {
            return { valid: false, error: 'Parameter name cannot be empty' };
        }
    }

    return { valid: true };
}

/**
 * Substitute parameter values into SQL template
 * @param {string} sql - SQL template with {{param}} placeholders
 * @param {Object<string, string>} values - Map of parameter name to value
 * @returns {string} SQL with values substituted
 */
export function substituteParameters(sql, values) {
    if (!sql || typeof sql !== 'string') return sql;
    if (!values || typeof values !== 'object') return sql;

    // Create case-sensitive value lookup
    const valueLookup = {};
    for (const [key, val] of Object.entries(values)) {
        valueLookup[key] = val;
    }

    return sql.replace(PARAM_REGEX, (match, paramName) => {
        const key = paramName.trim();
        if (key in valueLookup) {
            return valueLookup[key];
        }
        // If no value provided, leave placeholder as-is
        return match;
    });
}

/**
 * Build parameters array from SQL, preserving existing default values
 * @param {string} sql - SQL template
 * @param {Array<{name: string, defaultValue?: string}>} existingParams - Existing parameters
 * @returns {Array<{name: string, defaultValue: string}>}
 */
export function buildParametersFromSql(sql, existingParams = []) {
    const paramNames = extractParameters(sql);

    // Build lookup for existing defaults (case-sensitive)
    const existingDefaults = {};
    for (const p of existingParams) {
        if (p.name) {
            existingDefaults[p.name] = p.defaultValue || '';
        }
    }

    return paramNames.map(name => ({
        name: name,
        defaultValue: existingDefaults[name] || ''
    }));
}
