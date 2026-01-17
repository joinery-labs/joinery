/**
 * SQL IntelliSense Provider
 * Provides schema-aware completion suggestions for the Monaco Editor.
 *
 * Completion Behavior:
 * - schema.         -> Suggests tables/views in the specified schema.
 * - schema.table.   -> Suggests columns in the specified table.
 * - table.          -> Suggests columns (if the table exists in the main schema).
 * - (root level)    -> Suggests keywords, schemas, and main tables/views.
 */

import { monaco } from './monaco-loader.js';

// Standard ANSI SQL keywords.
const SQL_KEYWORDS = [
    // DML
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'IN', 'IS', 'LIKE', 'BETWEEN', 'EXISTS',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'TRUNCATE',
    // Joins
    'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL', 'ON', 'USING',
    // Grouping & Ordering
    'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST', 'LIMIT', 'OFFSET',
    // Set Operations
    'UNION', 'ALL', 'INTERSECT', 'EXCEPT', 'DISTINCT',
    // DDL
    'CREATE', 'DROP', 'ALTER', 'TABLE', 'VIEW', 'INDEX', 'SCHEMA', 'DATABASE',
    'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT', 'CONSTRAINT',
    // Conditional
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IF',
    // CTEs
    'AS', 'WITH', 'RECURSIVE',
    // Types
    'INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'DECIMAL', 'NUMERIC', 'REAL', 'FLOAT', 'DOUBLE',
    'VARCHAR', 'CHAR', 'TEXT', 'BOOLEAN', 'BOOL', 'DATE', 'TIME', 'TIMESTAMP', 'INTERVAL',
    // Functions
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CAST', 'COALESCE', 'NULLIF', 'GREATEST', 'LEAST',
    // Boolean literals
    'TRUE', 'FALSE'
];

// Cache CompletionItemKind for reuse.
const Kind = monaco.languages.CompletionItemKind;

// Pre-defined keyword suggestions without range information.
const KEYWORD_TEMPLATES = SQL_KEYWORDS.map(kw => ({
    label: kw,
    kind: Kind.Keyword,
    insertText: kw,
    detail: ''
}));

// Module state.
let _initialized = false;
let _schemaFetcher = null;
let _schemaCache = null;
let _schemaCacheTime = 0;
const CACHE_TTL_MS = 5000;

/**
 * Retrieves the cached schema or fetches a fresh one if the cache is expired.
 */
async function getSchema() {
    if (!_schemaFetcher) return null;

    const now = Date.now();
    if (_schemaCache && (now - _schemaCacheTime < CACHE_TTL_MS)) {
        return _schemaCache;
    }

    try {
        _schemaCache = await _schemaFetcher();
        _schemaCacheTime = now;
        return _schemaCache;
    } catch (e) {
        console.warn('Schema fetch failed:', e);
        return null;
    }
}

/**
 * Deduplicates suggestions based on their labels.
 */
function dedupe(suggestions) {
    const seen = new Set();
    return suggestions.filter(s => {
        if (seen.has(s.label)) return false;
        seen.add(s.label);
        return true;
    });
}

/**
 * Enables SQL IntelliSense for the editor.
 * @param {Function} fetcher - Async function that returns the schema object.
 */
export function enableSqlSuggestions(fetcher) {
    if (_initialized) return;
    _schemaFetcher = fetcher;
    _initialized = true;

    monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' '],

        async provideCompletionItems(model, position) {
            const line = model.getLineContent(position.lineNumber);
            const textBefore = line.substring(0, position.column - 1);

            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };

            const schema = await getSchema();
            const suggestions = [];

            // Handle "schema.table." completion pattern.
            const match2Dots = textBefore.match(/(\w+)\.(\w+)\.$/);
            if (match2Dots) {
                const key = `${match2Dots[1].toLowerCase()}.${match2Dots[2].toLowerCase()}`;
                const cols = schema?.columnsByTable?.get(key);
                if (cols) {
                    for (const c of cols) {
                        suggestions.push({ label: c, kind: Kind.Field, insertText: c, range, detail: 'Column' });
                    }
                    return { suggestions: dedupe(suggestions) };
                }
            }

            // Handle "identifier." completion pattern.
            const match1Dot = textBefore.match(/(\w+)\.$/);
            if (match1Dot) {
                const id = match1Dot[1].toLowerCase();

                // Suggest tables and views for the matched schema.
                const relations = schema?.relationsBySchema?.get(id);
                if (relations) {
                    for (const r of relations) {
                        suggestions.push({ label: r, kind: Kind.Class, insertText: r, range, detail: 'Table/View' });
                    }
                }

                // Suggest columns for tables in the main schema.
                const cols = schema?.columnsByTable?.get(`main.${id}`);
                if (cols) {
                    for (const c of cols) {
                        suggestions.push({ label: c, kind: Kind.Field, insertText: c, range, detail: 'Column' });
                    }
                }

                if (suggestions.length > 0) {
                    return { suggestions: dedupe(suggestions) };
                }
            }

            // Provide root-level suggestions: keywords, schemas, and main tables/views.
            // Add keyword suggestions.
            for (const tpl of KEYWORD_TEMPLATES) {
                suggestions.push({ ...tpl, range });
            }

            if (schema?.schemas) {
                for (const s of schema.schemas) {
                    suggestions.push({ label: s, kind: Kind.Module, insertText: s, range, detail: 'Schema' });
                }
            }

            if (schema?.mainTables) {
                for (const t of schema.mainTables) {
                    suggestions.push({ label: t, kind: Kind.Class, insertText: t, range, detail: 'Table' });
                }
            }

            if (schema?.mainViews) {
                for (const v of schema.mainViews) {
                    suggestions.push({ label: v, kind: Kind.Interface, insertText: v, range, detail: 'View' });
                }
            }

            return { suggestions: dedupe(suggestions) };
        }
    });
}

/**
 * Invalidates the schema cache. Should be called when the database context changes.
 */
export function invalidateSchemaCache() {
    _schemaCache = null;
    _schemaCacheTime = 0;
}
