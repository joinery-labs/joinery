/**
 * SQL IntelliSense Provider
 * Schema-aware completion suggestions for Monaco Editor.
 */

import { monaco } from './monaco-loader.js';
import { getIntellisenseSchema } from '../core/schema-cache.js';

// ANSI SQL keywords
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

// Cached CompletionItemKind reference
const Kind = monaco.languages.CompletionItemKind;

// Pre-built keyword suggestions
const KEYWORD_TEMPLATES = SQL_KEYWORDS.map(kw => ({
    label: kw,
    kind: Kind.Keyword,
    insertText: kw,
    detail: ''
}));

let _initialized = false;

/** Deduplicate suggestions by label. */
function dedupe(suggestions) {
    const seen = new Set();
    return suggestions.filter(s => {
        if (seen.has(s.label)) return false;
        seen.add(s.label);
        return true;
    });
}

/**
 * Enable SQL IntelliSense using centralized schema cache.
 */
export function enableSqlSuggestions() {
    if (_initialized) return;
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

            const schema = await getIntellisenseSchema();
            const suggestions = [];

            // schema.table. -> columns
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

            // identifier. -> tables/views or columns
            const match1Dot = textBefore.match(/(\w+)\.$/);
            if (match1Dot) {
                const id = match1Dot[1].toLowerCase();


                const relations = schema?.relationsBySchema?.get(id);
                if (relations) {
                    for (const r of relations) {
                        suggestions.push({ label: r, kind: Kind.Class, insertText: r, range, detail: 'Table/View' });
                    }
                }


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

            // Root-level: keywords, schemas, main tables/views
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
