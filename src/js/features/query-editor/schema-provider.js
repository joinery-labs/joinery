/**
 * Schema Provider
 * 
 * Retrieves database schema information to support SQL IntelliSense / Autocomplete.
 * 
 * Returns:
 * - schemas: List of available schema names.
 * - relationsBySchema: Map<schema, [table/view names]>.
 * - columnsByTable: Map<"schema.table", [column names]>.
 * - mainTables: Tables in the main schema (for top-level suggestions).
 * - mainViews: Views in the main schema (for top-level suggestions).
 */

import { getConn } from '../../core/database.js';

/**
 * Helper function: Executes a query and maps the result set to an array of row objects.
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
 * Helper function: Executes a query and returns the values of the first column as a string array.
 */
async function queryColumn(conn, sql) {
    try {
        const result = await conn.query(sql);
        const arr = [];
        if (result.numRows > 0) {
            const col = result.getChildAt(0);
            for (let i = 0; i < result.numRows; i++) {
                const val = col.get(i);
                if (val != null) arr.push(String(val));
            }
        }
        return arr;
    } catch (e) {
        console.warn('Schema query failed:', e);
        return [];
    }
}

/**
 * Retrieves the complete database schema structure (tables, views, columns) from DuckDB.
 */
export async function fetchDuckDbSchema() {
    const conn = getConn();
    if (!conn) {
        return { schemas: [], relationsBySchema: new Map(), columnsByTable: new Map(), mainTables: [], mainViews: [] };
    }

    try {
        const [schemas, tables, views, columns] = await Promise.all([
            queryColumn(conn, `
                SELECT schema_name FROM information_schema.schemata 
                WHERE schema_name NOT IN ('information_schema', 'pg_catalog') 
                AND schema_name NOT LIKE 'pg_%'
                ORDER BY schema_name
            `),
            queryRows(conn, `
                SELECT table_schema, table_name FROM information_schema.tables 
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                AND table_schema NOT LIKE 'pg_%'
                ORDER BY table_schema, table_name
            `),
            queryRows(conn, `
                SELECT table_schema, table_name FROM information_schema.views
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                AND table_schema NOT LIKE 'pg_%'
                ORDER BY table_schema, table_name
            `),
            queryRows(conn, `
                SELECT table_schema, table_name, column_name FROM information_schema.columns 
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                AND table_schema NOT LIKE 'pg_%'
                ORDER BY table_schema, table_name, ordinal_position
            `)
        ]);

        const relationsBySchema = new Map();
        const columnsByTable = new Map();
        const mainTableSet = new Set();
        const mainViewSet = new Set();

        // Process tables
        for (const { table_schema, table_name } of tables) {
            const schemaKey = table_schema.toLowerCase();
            if (!relationsBySchema.has(schemaKey)) relationsBySchema.set(schemaKey, new Set());
            relationsBySchema.get(schemaKey).add(table_name);
            if (schemaKey === 'main') mainTableSet.add(table_name);
        }

        // Process views
        for (const { table_schema, table_name } of views) {
            const schemaKey = table_schema.toLowerCase();
            if (!relationsBySchema.has(schemaKey)) relationsBySchema.set(schemaKey, new Set());
            relationsBySchema.get(schemaKey).add(table_name);
            if (schemaKey === 'main') mainViewSet.add(table_name);
        }

        // Process columns
        for (const { table_schema, table_name, column_name } of columns) {
            const key = `${table_schema.toLowerCase()}.${table_name.toLowerCase()}`;
            if (!columnsByTable.has(key)) columnsByTable.set(key, new Set());
            columnsByTable.get(key).add(column_name);
        }

        // Convert Sets to Arrays for the return object
        const relationsAsArrays = new Map();
        for (const [k, v] of relationsBySchema) relationsAsArrays.set(k, [...v]);

        const columnsAsArrays = new Map();
        for (const [k, v] of columnsByTable) columnsAsArrays.set(k, [...v]);

        return {
            schemas: [...new Set(schemas)], // Dedupe schemas too
            relationsBySchema: relationsAsArrays,
            columnsByTable: columnsAsArrays,
            mainTables: [...mainTableSet],
            mainViews: [...mainViewSet]
        };
    } catch (err) {
        console.error('Error fetching schema:', err);
        return { schemas: [], relationsBySchema: new Map(), columnsByTable: new Map(), mainTables: [], mainViews: [] };
    }
}
