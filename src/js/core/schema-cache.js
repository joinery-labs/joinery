/**
 * Schema Cache
 * Centralized schema data cache providing a single source of truth
 * for database schema information across all components.
 */

import { on, Events } from './event-bus.js';
import { getConn } from './database.js';

// ============================================================================
// Private State
// ============================================================================

/** @type {object|null} Cached schema data */
let schemaCache = null;

/** @type {boolean} Whether a fetch is currently in progress */
let fetchInProgress = false;

/** @type {Promise|null} Current fetch promise (for deduplication) */
let fetchPromise = null;

/** @type {Set<Function>} Subscribers for schema changes */
const subscribers = new Set();

// ============================================================================
// Schema Fetching
// ============================================================================

/**
 * Execute query and return rows as objects.
 */
async function queryRows(conn, sql) {
    try {
        const result = await conn.query(sql);
        const cols = result.schema.fields.map(f => f.name);
        const rows = [];
        for (let i = 0; i < result.numRows; i++) {
            const obj = {};
            for (let j = 0; j < cols.length; j++) {
                obj[cols[j]] = result.getChildAt(j).get(i);
            }
            rows.push(obj);
        }
        return rows;
    } catch (e) {
        console.warn('Schema query failed:', e);
        return [];
    }
}

/**
 * Fetch schema data from database.
 */
async function fetchSchemaFromDb() {
    const conn = getConn();
    if (!conn) {
        return { schemas: [] };
    }

    try {
        const [schemas, tables, columns] = await Promise.all([
            queryRows(conn, `
                SELECT DISTINCT schema_name 
                FROM information_schema.schemata 
                WHERE schema_name NOT IN ('information_schema', 'pg_catalog') 
                AND schema_name NOT LIKE 'pg_%'
                ORDER BY schema_name
            `),
            queryRows(conn, `
                SELECT table_schema, table_name, table_type
                FROM information_schema.tables 
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                AND table_schema NOT LIKE 'pg_%'
                ORDER BY table_schema, table_name
            `),
            queryRows(conn, `
                SELECT table_schema, table_name, column_name, data_type, ordinal_position, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                AND table_schema NOT LIKE 'pg_%'
                ORDER BY table_schema, table_name, ordinal_position
            `)
        ]);

        const schemaMap = new Map();

        for (const { schema_name } of schemas) {
            schemaMap.set(schema_name, {
                name: schema_name,
                tables: new Map()
            });
        }

        for (const { table_schema, table_name, table_type } of tables) {
            let schema = schemaMap.get(table_schema);
            if (!schema) {
                schema = { name: table_schema, tables: new Map() };
                schemaMap.set(table_schema, schema);
            }
            schema.tables.set(table_name, {
                name: table_name,
                type: table_type === 'VIEW' ? 'view' : 'table',
                columns: []
            });
        }

        for (const { table_schema, table_name, column_name, data_type, is_nullable, column_default } of columns) {
            const schema = schemaMap.get(table_schema);
            if (schema) {
                const table = schema.tables.get(table_name);
                if (table) {
                    table.columns.push({
                        name: column_name,
                        type: data_type,
                        is_nullable,
                        column_default
                    });
                }
            }
        }

        return {
            schemas: Array.from(schemaMap.values()).map(schema => ({
                name: schema.name,
                tables: Array.from(schema.tables.values())
            }))
        };
    } catch (err) {
        console.error('Error fetching schema:', err);
        return { schemas: [] };
    }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get schema data (from cache or fresh fetch)
 * @param {boolean} [forceRefresh=false] - Force a fresh fetch
 * @returns {Promise<object>} Schema data
 */
export async function getSchemaData(forceRefresh = false) {
    if (schemaCache && !forceRefresh) {
        return schemaCache;
    }

    if (fetchInProgress && fetchPromise) {
        return fetchPromise;
    }

    fetchInProgress = true;
    fetchPromise = fetchSchemaFromDb().then(data => {
        schemaCache = data;
        fetchInProgress = false;
        fetchPromise = null;
        return data;
    }).catch(err => {
        fetchInProgress = false;
        fetchPromise = null;
        throw err;
    });

    return fetchPromise;
}

/**
 * Invalidate cache; next fetch will query the database.
 */
export function invalidateSchemaCache() {
    schemaCache = null;
}

/**
 * Subscribe to schema change notifications
 * @param {Function} callback - Called when schema changes
 * @returns {Function} Unsubscribe function
 */
export function subscribeToSchemaChanges(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

/** Notify all subscribers. */
function notifySubscribers() {
    for (const callback of subscribers) {
        try {
            callback();
        } catch (err) {
            console.error('[SchemaCache] Error in subscriber:', err);
        }
    }
}

/**
 * Refresh cache and notify subscribers.
 */
export async function refreshSchemaCache() {
    invalidateSchemaCache();
    await getSchemaData(true);
    notifySubscribers();
}

/**
 * Get schema data optimized for SQL IntelliSense.
 * Returns Maps for O(1) lookup of tables by schema and columns by table.
 */
export async function getIntellisenseSchema() {
    const data = await getSchemaData();

    if (!data || !data.schemas || data.schemas.length === 0) {
        return {
            schemas: [],
            relationsBySchema: new Map(),
            columnsByTable: new Map(),
            mainTables: [],
            mainViews: []
        };
    }

    const schemaNames = [];
    const relationsBySchema = new Map();
    const columnsByTable = new Map();
    const mainTables = [];
    const mainViews = [];

    for (const schema of data.schemas) {
        const schemaKey = schema.name.toLowerCase();
        schemaNames.push(schema.name);

        const tableNames = [];
        for (const table of schema.tables || []) {
            tableNames.push(table.name);


            const tableKey = `${schemaKey}.${table.name.toLowerCase()}`;
            const columnNames = (table.columns || []).map(c => c.name);
            columnsByTable.set(tableKey, columnNames);


            if (schemaKey === 'main') {
                if (table.type === 'view') {
                    mainViews.push(table.name);
                } else {
                    mainTables.push(table.name);
                }
            }
        }

        relationsBySchema.set(schemaKey, tableNames);
    }

    return {
        schemas: schemaNames,
        relationsBySchema,
        columnsByTable,
        mainTables,
        mainViews
    };
}

// ============================================================================
// Derived Accessors (for use by other modules)
// ============================================================================

/**
 * Get list of schema names for dropdowns.
 * Returns schemas from cache, ensuring 'main' is first.
 * @returns {Promise<string[]>} Schema names
 */
export async function getSchemaList() {
    const data = await getSchemaData();
    if (!data || !data.schemas || data.schemas.length === 0) {
        return ['main'];
    }

    const names = data.schemas.map(s => s.name);
    const filtered = names.filter(n => n !== 'main');
    return ['main', ...filtered];
}

/**
 * Get all tables grouped by schema for dropdowns.
 * Returns object with schema names as keys and table info arrays as values.
 * @returns {Promise<{allTables: Array<{table_schema: string, table_name: string}>, schemas: string[]}>}
 */
export async function getTablesBySchema() {
    const data = await getSchemaData();
    if (!data || !data.schemas || data.schemas.length === 0) {
        return { allTables: [], schemas: ['main'] };
    }

    const allTables = [];
    const schemaNames = [];

    for (const schema of data.schemas) {
        schemaNames.push(schema.name);
        for (const table of schema.tables || []) {
            if (table.type !== 'view') {
                allTables.push({
                    table_schema: schema.name,
                    table_name: table.name
                });
            }
        }
    }

    const filtered = schemaNames.filter(n => n !== 'main');
    const schemas = ['main', ...filtered];

    return { allTables, schemas };
}

/**
 * Get column details for a specific table.
 * Returns array of column metadata from cache.
 * @param {string} schemaName - Schema name
 * @param {string} tableName - Table name
 * @returns {Promise<Array<{column_name: string, data_type: string, is_nullable: string, column_default: string|null}>>}
 */
export async function getTableColumns(schemaName, tableName) {
    const data = await getSchemaData();
    if (!data || !data.schemas) {
        return [];
    }

    const schema = data.schemas.find(s => s.name === schemaName);
    if (!schema || !schema.tables) {
        return [];
    }

    const table = schema.tables.find(t => t.name === tableName);
    if (!table || !table.columns) {
        return [];
    }

    return table.columns.map((col, idx) => ({
        column_name: col.name,
        data_type: col.type,
        is_nullable: col.is_nullable,
        column_default: col.column_default,
        ordinal_position: idx + 1
    }));
}

/**
 * Check if a table exists in the specified schema.
 * Uses cached data for efficient lookups by default.
 * @param {string} tableName - Table name to check
 * @param {string} [schemaName='main'] - Schema name
 * @param {boolean} [forceRefresh=false] - Force fresh database check (use for write operations)
 * @returns {Promise<boolean>} True if table exists
 */
export async function tableExists(tableName, schemaName = 'main', forceRefresh = false) {
    const data = await getSchemaData(forceRefresh);
    if (!data || !data.schemas) return false;

    const schema = data.schemas.find(s => s.name === schemaName);
    if (!schema || !schema.tables) return false;

    return schema.tables.some(t => t.name === tableName);
}

// ============================================================================
// Event Bus Integration
// ============================================================================

on(Events.SCHEMA_CHANGED, () => {
    refreshSchemaCache();
});

on(Events.DATABASE_SWITCHED, () => {
    refreshSchemaCache();
});

