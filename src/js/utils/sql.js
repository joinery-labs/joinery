/**
 * SQL utility functions  
 * SQL string manipulation, parsing, and identifier handling
 */

import { hasTimePart, formatDateSafe, formatDateTimeSafe } from './date-parsing.js';

// ============================================================================
// Pre-compiled Regex Patterns
// ============================================================================

const REGEX_SINGLE_QUOTE = /'/g;
const REGEX_DOUBLE_QUOTE = /"/g;
const REGEX_INVALID_IDENT_CHARS = /[^A-Za-z0-9_]/g;
const REGEX_LEADING_DIGIT = /^(\d)/;
const REGEX_MULTIPLE_UNDERSCORES = /_+/g;
const REGEX_CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const REGEX_LEADING_SPECIAL = /^[=+\-@]/;
const REGEX_LEADING_TRAILING_UNDERSCORES = /^_+|_+$/g;
const REGEX_WHITESPACE = /\s+/g;
const REGEX_TRAILING_SEMICOLONS = /\s*;+\s*$/;
const REGEX_LINE_COMMENTS = /^--.*$/gm;

// ============================================================================
// LRU Cache
// ============================================================================

class LRUCache {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return undefined;
        // Move to end (most recently used)
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Delete oldest (first) entry
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    clear() {
        this.cache.clear();
    }
}

const _canonicalizeCache = new LRUCache(200);
const _stripCommentsCache = new LRUCache(100);

// ============================================================================
// SQL String Escaping
// ============================================================================

export const sqlStringEscape = s => String(s).replace(REGEX_SINGLE_QUOTE, "''");
export const quoteIdent = name => `"${String(name).replace(REGEX_DOUBLE_QUOTE, '""')}"`;

/**
 * Sanitize identifier for use as table/column name
 * @param {string} name - Raw name
 * @param {string} fallback - Fallback if empty
 * @returns {string} Sanitized identifier
*/
export function sanitizeIdentifier(name, fallback = "Table") {
    let x = (name == null ? "" : String(name)).trim().replace(REGEX_INVALID_IDENT_CHARS, "_");
    if (!x) x = fallback;
    x = x.replace(REGEX_LEADING_DIGIT, "_$1").replace(REGEX_MULTIPLE_UNDERSCORES, "_");
    return x.slice(0, 63);
}

// ============================================================================
// SQL Statement Splitting
// ============================================================================

/**
 * Split SQL text into individual statements
 * @param {string} sql - SQL text
 * @returns {Array<string>} Array of statements
 */
export function splitSQLStatements(sql) {
    const out = [];
    const len = sql.length;
    let cur = "";
    let inS = false, inD = false, inB = false, lineC = false, blockC = false;

    for (let i = 0; i < len; i++) {
        const ch = sql[i];
        const nxt = sql[i + 1];

        if (!inS && !inD && !inB) {
            if (!blockC && ch === "-" && nxt === "-") {
                lineC = true;
                cur += ch;
                continue;
            }
            if (!lineC && ch === "/" && nxt === "*") {
                blockC = true;
                cur += ch;
                continue;
            }
        }
        if (lineC) {
            cur += ch;
            if (ch === "\n") lineC = false;
            continue;
        }
        if (blockC) {
            cur += ch;
            if (ch === "*" && nxt === "/") {
                cur += "/";
                i++;
                blockC = false;
            }
            continue;
        }
        if (ch === "'" && !inD && !inB) {
            inS = !inS;
            cur += ch;
            continue;
        }
        if (ch === '"' && !inS && !inB) {
            inD = !inD;
            cur += ch;
            continue;
        }
        if (ch === '`' && !inS && !inD) {
            inB = !inB;
            cur += ch;
            continue;
        }
        if (ch === ";" && !inS && !inD && !inB) {
            const t = cur.trim();
            if (t) out.push(t);
            cur = "";
        } else {
            cur += ch;
        }
    }
    const t = cur.trim();
    if (t) out.push(t);
    return out;
}

// ============================================================================
// SQL Classification
// ============================================================================

/**
 * Classify SQL statement type
 * @param {string} sql - SQL statement
 * @returns {string} Statement type (SELECT, DML, DDL, or keyword)
 */
export function classifySQL(sql) {
    const t = sql.trim().replace(REGEX_LINE_COMMENTS, "").trim().toUpperCase();
    const k = t.split(/\s+/)[0] || "";
    if (k === "SELECT" || k === "WITH") return "SELECT";
    if (k === "INSERT" || k === "UPDATE" || k === "DELETE" || k === "REPLACE") return "DML";
    if (k === "CREATE" || k === "ALTER" || k === "DROP") return "DDL";
    return k || "SQL";
}

// ============================================================================
// SQL Comment Stripping
// ============================================================================

/**
 * Strip SQL comments while preserving string literals
 * @param {string} input - SQL input
 * @param {object} opts - Options
 * @returns {string} SQL without comments
 */
function stripSQLComments(input, opts = {}) {
    const cacheKey = input + JSON.stringify(opts);
    const cached = _stripCommentsCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const result = _stripSQLCommentsInternal(input, opts);
    _stripCommentsCache.set(cacheKey, result);
    return result;
}

function _stripSQLCommentsInternal(input, opts = {}) {
    const { preserveNewlines = true, mysqlHashComments = false, nestedBlockComments = true } = opts;
    const s = String(input);
    const out = [];
    const n = s.length;
    let i = 0;

    let inSingle = false, inDouble = false, inBacktick = false, inBracket = false, blockDepth = 0, dollarTag = null;

    const isTagChar = (c) => {
        const code = c.charCodeAt(0);
        return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code === 95) || (code >= 97 && code <= 122);
    };

    const startsDollarTag = (idx) => {
        if (s[idx] !== '$') return null;
        let j = idx + 1;
        while (j < n && isTagChar(s[j])) j++;
        return (j < n && s[j] === '$') ? s.slice(idx, j + 1) : null;
    };

    while (i < n) {
        const ch = s[i];
        const next = i + 1 < n ? s[i + 1] : '';

        if (dollarTag) {
            if (s.startsWith(dollarTag, i)) {
                out.push(dollarTag);
                i += dollarTag.length;
                dollarTag = null;
            } else {
                out.push(ch);
                i++;
            }
            continue;
        }

        if (inSingle) {
            if (ch === "'") {
                if (next === "'") {
                    out.push("''");
                    i += 2;
                } else {
                    out.push("'");
                    inSingle = false;
                    i++;
                }
            } else if (ch === '\\') {
                out.push(ch);
                if (i + 1 < n) out.push(s[i + 1]);
                i += Math.min(2, n - i);
            } else {
                out.push(ch);
                i++;
            }
            continue;
        }
        if (inDouble) {
            if (ch === '"') {
                if (next === '"') {
                    out.push('""');
                    i += 2;
                } else {
                    out.push('"');
                    inDouble = false;
                    i++;
                }
            } else {
                out.push(ch);
                i++;
            }
            continue;
        }
        if (inBacktick) {
            if (ch === '`') {
                if (next === '`') {
                    out.push('``');
                    i += 2;
                } else {
                    out.push('`');
                    inBacktick = false;
                    i++;
                }
            } else {
                out.push(ch);
                i++;
            }
            continue;
        }
        if (inBracket) {
            if (ch === ']') {
                if (next === ']') {
                    out.push(']]');
                    i += 2;
                } else {
                    out.push(']');
                    inBracket = false;
                    i++;
                }
            } else {
                out.push(ch);
                i++;
            }
            continue;
        }

        if (blockDepth > 0) {
            if (ch === '/' && next === '*') {
                if (nestedBlockComments) blockDepth++;
                i += 2;
                continue;
            }
            if (ch === '*' && next === '/') {
                blockDepth--;
                i += 2;
                continue;
            }
            if (preserveNewlines && (ch === '\n' || ch === '\r')) out.push(ch);
            i++;
            continue;
        }

        if (ch === '-' && next === '-') {
            i += 2;
            while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
            if (preserveNewlines && i < n) {
                const endCh = s[i++];
                out.push(endCh);
                if (endCh === '\r' && i < n && s[i] === '\n') {
                    out.push('\n');
                    i++;
                }
            }
            continue;
        }
        if (mysqlHashComments && ch === '#') {
            i++;
            while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
            if (preserveNewlines && i < n) {
                const endCh = s[i++];
                out.push(endCh);
                if (endCh === '\r' && i < n && s[i] === '\n') {
                    out.push('\n');
                    i++;
                }
            }
            continue;
        }

        if (ch === '/' && next === '*') {
            blockDepth = 1;
            i += 2;
            continue;
        }

        if (ch === "'") {
            inSingle = true;
            out.push(ch);
            i++;
            continue;
        }
        if (ch === '"') {
            inDouble = true;
            out.push(ch);
            i++;
            continue;
        }
        if (ch === '`') {
            inBacktick = true;
            out.push(ch);
            i++;
            continue;
        }
        if (ch === '[') {
            inBracket = true;
            out.push(ch);
            i++;
            continue;
        }

        if (ch === '$') {
            const tag = startsDollarTag(i);
            if (tag) {
                dollarTag = tag;
                out.push(tag);
                i += tag.length;
                continue;
            }
        }

        out.push(ch);
        i++;
    }

    return out.join('');
}

// ============================================================================
// Canonicalization
// ============================================================================

/**
 * Canonicalize statement (remove comments, normalize whitespace)
 * @param {string} s - SQL statement
 * @returns {string} Canonicalized statement
 */
export function canonicalizeStatement(s) {
    // Check cache first
    const cached = _canonicalizeCache.get(s);
    if (cached !== undefined) return cached;

    const noComments = stripSQLComments(s);
    let oneLine = noComments.replace(REGEX_WHITESPACE, " ").trim();
    oneLine = oneLine.replace(REGEX_TRAILING_SEMICOLONS, "");
    const result = oneLine ? oneLine + ";" : "";

    _canonicalizeCache.set(s, result);
    return result;
}



// ============================================================================
// Column Label Normalization
// ============================================================================

/**
 * Normalize column labels for SQL (handle special characters, ensure uniqueness)
 * @param {Array} rawLabels - Raw labels
 * @param {object} options - Options
 * @returns {object} Normalized labels
 */
export function normalizeColumnLabels(rawLabels, { maxLen = 63, fallback = "Column" } = {}) {
    const base = (rawLabels || []).map(v => {
        let s;
        if (v instanceof Date) {
            s = hasTimePart(v) ? formatDateTimeSafe(v) : formatDateSafe(v);
            s = s || String(v);
        } else {
            s = (v == null ? "" : String(v));
        }
        s = s.replace(REGEX_CONTROL_CHARS, "").trim();
        if (REGEX_LEADING_SPECIAL.test(s)) s = "_" + s;
        s = s.replace(REGEX_INVALID_IDENT_CHARS, "_");
        s = s.replace(REGEX_MULTIPLE_UNDERSCORES, "_").replace(REGEX_LEADING_TRAILING_UNDERSCORES, "");
        if (!s) s = fallback;
        return s.slice(0, maxLen);
    });

    const seen = Object.create(null);
    const sql = base.map(name => {
        if (!seen[name]) {
            seen[name] = 1;
            return name;
        }
        let k = ++seen[name];
        let candidate = `${name}_${k}`;
        if (candidate.length > maxLen) {
            const keep = Math.max(1, maxLen - (`_${k}`).length);
            candidate = `${name.slice(0, keep)}_${k}`;
        }
        while (seen[candidate]) {
            k = ++seen[name];
            candidate = `${name}_${k}`;
            if (candidate.length > maxLen) {
                const keep = Math.max(1, maxLen - (`_${k}`).length);
                candidate = `${name.slice(0, keep)}_${k}`;
            }
        }
        seen[candidate] = 1;
        return candidate;
    });

    return { labels: sql, sql, map: Object.fromEntries(sql.map(n => [n, n])) };
}
