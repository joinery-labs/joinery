/**
 * Database Import Module
 * Manages the import of databases from .db or .duckdb files.
 * Supports merging tables into existing databases or creating new ones based on
 * conflict detection.
 */

import {
    hasDatabase,
    getDatabaseState,
    registerDatabaseState,
    unregisterDatabaseState,
    refreshDbSelect,
    switchDatabase
} from '../../core/database.js';
import { emit, Events } from '../../core/event-bus.js';
import { startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { quoteIdent, sanitizeIdentifier } from '../../utils/sql.js';
import { createDuckDbInstance, disposeDuckDbInstance, registerFile, registerFileFromPath, dropFile } from '../../core/duckdb-factory.js';
import { forceCheckpoint } from '../../core/checkpoint-manager.js';
import { getDatabasePath, hasPersistentStorage, deleteDatabaseFile, copyDatabaseFile } from '../../platform/database-path.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get existing user-created tables from a database connection
 * @param {object} conn - DuckDB connection
 * @returns {Promise<Set<string>>} Set of "schema.table" keys
 */
async function getExistingTables(conn) {
    const result = await conn.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('information_schema', 'pg_catalog')
        ORDER BY table_schema, table_name;
    `);
    const tables = new Set();
    for (const row of result.toArray()) {
        const schema = row.table_schema || 'main';
        tables.add(`${schema}.${row.table_name}`);
    }
    return tables;
}

/**
 * Check if two sets have any overlapping elements
 * @param {Set<string>} setA 
 * @param {Set<string>} setB 
 * @returns {boolean} True if conflict exists
 */
function hasConflicts(setA, setB) {
    for (const item of setA) {
        if (setB.has(item)) return true;
    }
    return false;
}

/**
 * Build notification details for import completion
 * @param {Array} importedTables - Array of {schema, name, rows}
 * @param {string} dbName - Database name
 * @param {boolean} isMerge - Whether this was a merge operation
 * @returns {{message: string, details: string[]}}
 */
function buildImportNotification(importedTables, dbName, isMerge) {
    const actionWord = isMerge ? "Merged" : "Imported";
    const details = importedTables.map(t => {
        const qualified = t.schema && t.schema !== "main"
            ? `${dbName}.${t.schema}.${t.name}`
            : `${dbName}.${t.name}`;
        return `${qualified} (${t.rows.toLocaleString()} rows)`;
    });
    const message = `${actionWord} ${importedTables.length} table${importedTables.length === 1 ? "" : "s"} into ${dbName}`;
    return { message, details };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Imports a database from a .db or .duckdb file.
 * Strategy:
 * - New Database: If no database with the import name exists, a new one is created.
 * - Merge: If the database exists and there are no table conflicts, new tables are merged in.
 * - Rename: If conflicts exist, a new database is created with a unique name (e.g., imported_1).
 * 
 * @param {File} file - The database file object to import.
 * @param {string|null} sourcePath - (Optional) The absolute path to the file (Tauri only).
 */
export async function importDatabase(file, sourcePath = null) {
    const op = startNotification({
        title: 'Importing Database',
        status: 'Starting import...'
    });

    // Track resources for cleanup on error
    let createdInstance = null;
    let registeredDbName = null;

    try {
        const fileExt = file.name.toLowerCase().split('.').pop();

        if (fileExt !== 'db' && fileExt !== 'duckdb') {
            op.end({
                success: false,
                message: 'Unsupported format',
                dismissDelay: NOTIFICATION_TIMING.ERROR,
                details: ["Only .db and .duckdb files are supported"]
            });
            return;
        }

        const baseNameFromFile = sanitizeIdentifier(
            file.name.replace(/\.(db|duckdb)$/i, '') || "imported",
            "imported"
        );

        // Determine target database name and check for conflicts
        let dbName = baseNameFromFile;
        let targetState = null;
        let isMerge = false;
        let incomingTables = null;

        if (hasDatabase(baseNameFromFile)) {
            // Database exists: Analyze structure for potential conflicts.
            op.update({ status: 'Checking for conflicts...' });

            // specific: Create a temporary in-memory instance to inspect the imported file safely.
            const tempInstance = await createDuckDbInstance();
            try {
                // Register the file and attach to read table list
                // Use path-based registration for Tauri (memory-efficient)
                const registeredPath = sourcePath
                    ? await registerFileFromPath(tempInstance, file.name, sourcePath)
                    : await registerFile(tempInstance, file.name, file);
                const attachPath = registeredPath || file.name;
                await tempInstance.conn.query(`ATTACH '${attachPath.replace(/'/g, "''")}' AS imported_db (READ_ONLY);`);

                // Get tables from attached database
                const tablesRes = await tempInstance.conn.query(`
                    SELECT schema_name, table_name
                    FROM duckdb_tables()
                    WHERE database_name = 'imported_db'
                      AND (schema_name IS NULL OR schema_name NOT IN ('information_schema'))
                    ORDER BY schema_name, table_name;
                `);

                incomingTables = tablesRes.toArray();
                const incomingSet = new Set(incomingTables.map(t =>
                    `${t.schema_name || 'main'}.${t.table_name}`
                ));

                // Check against existing database - switch to it to trigger lazy load if needed
                await switchDatabase(baseNameFromFile);
                const existingState = getDatabaseState(baseNameFromFile);
                const existingTables = await getExistingTables(existingState.conn);

                if (hasConflicts(existingTables, incomingSet)) {
                    // Conflicts - create new DB with unique name
                    let counter = 1;
                    while (hasDatabase(dbName)) dbName = `${baseNameFromFile}_${counter++}`;
                    isMerge = false;
                } else {
                    // No conflicts - merge into existing
                    isMerge = true;
                    targetState = existingState;
                }
            } finally {
                await disposeDuckDbInstance(tempInstance);
            }
        }

        const importedTables = [];

        if (isMerge && targetState) {
            // Strategy: MERGE
            // Action: Attach the imported file to the existing database and copy non-conflicting tables.
            op.update({ status: 'Merging tables...' });

            // Use path-based registration for Tauri (memory-efficient)
            const registeredPath = sourcePath
                ? await registerFileFromPath(targetState, file.name, sourcePath)
                : await registerFile(targetState, file.name, file);
            const attachPath = registeredPath || file.name;
            await targetState.conn.query(`ATTACH '${attachPath.replace(/'/g, "''")}' AS imported_db (READ_ONLY);`);

            try {
                // Copy each table using INSERT...SELECT
                for (const { schema_name, table_name } of incomingTables) {
                    const schema = schema_name || "main";
                    const srcQualified = `imported_db.${quoteIdent(schema)}.${quoteIdent(table_name)}`;
                    const dstQualified = schema !== "main"
                        ? `${quoteIdent(schema)}.${quoteIdent(table_name)}`
                        : quoteIdent(table_name);

                    // Create schema if needed
                    if (schema !== "main") {
                        await targetState.conn.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)};`);
                    }

                    // Create table from imported data
                    await targetState.conn.query(`CREATE TABLE ${dstQualified} AS SELECT * FROM ${srcQualified};`);

                    // Get row count
                    const cntRes = await targetState.conn.query(`SELECT COUNT(*) AS cnt FROM ${dstQualified};`);
                    const rows = Number(cntRes.toArray()[0]?.cnt || 0);
                    importedTables.push({ schema, name: table_name, rows });
                }
            } finally {
                // Detach imported database and cleanup registered file
                try { await targetState.conn.query(`DETACH imported_db;`); } catch { /* ignore */ }
                try { await dropFile(targetState, file.name); } catch { /* ignore cleanup errors */ }
            }

        } else {
            // Strategy: NEW DATABASE
            // Action: Write the file directly to storage and register it as a new database.
            op.update({ status: 'Creating database...' });

            if (hasPersistentStorage()) {
                // Persistent Storage: Copy the file to the platform-specific storage location.
                op.update({ status: 'Copying database file...' });
                await copyDatabaseFile(dbName, file, sourcePath);
                const persistentPath = await getDatabasePath(dbName);

                // Open the copied file as a DuckDB instance
                createdInstance = await createDuckDbInstance(persistentPath);
                registeredDbName = dbName;

                const fullState = { ...createdInstance, persistentPath };
                registerDatabaseState(dbName, fullState);
                targetState = fullState;
            } else {
                // No persistent storage - create in-memory and import via attach
                createdInstance = await createDuckDbInstance();
                registeredDbName = dbName;

                const fullState = { ...createdInstance, persistentPath: null };
                registerDatabaseState(dbName, fullState);
                targetState = fullState;

                // Register file and attach to copy tables
                const registeredPath = await registerFile(targetState, file.name, file);
                const attachPath = registeredPath || file.name;
                await targetState.conn.query(`ATTACH '${attachPath.replace(/'/g, "''")}' AS imported_db (READ_ONLY);`);

                // Get tables and copy them
                const tablesRes = await targetState.conn.query(`
                    SELECT schema_name, table_name
                    FROM duckdb_tables()
                    WHERE database_name = 'imported_db'
                    ORDER BY schema_name, table_name;
                `);

                for (const { schema_name, table_name } of tablesRes.toArray()) {
                    const schema = schema_name || "main";
                    const srcQualified = `imported_db.${quoteIdent(schema)}.${quoteIdent(table_name)}`;
                    const dstQualified = schema !== "main"
                        ? `${quoteIdent(schema)}.${quoteIdent(table_name)}`
                        : quoteIdent(table_name);

                    if (schema !== "main") {
                        await targetState.conn.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)};`);
                    }
                    await targetState.conn.query(`CREATE TABLE ${dstQualified} AS SELECT * FROM ${srcQualified};`);
                }

                await targetState.conn.query(`DETACH imported_db;`);
                // Cleanup registered file from VFS
                try { await dropFile(targetState, file.name); } catch { /* ignore cleanup errors */ }
            }

            // Get table info for notification
            const tablesRes = await targetState.conn.query(`
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE'
                  AND table_schema NOT IN ('information_schema', 'pg_catalog');
            `);

            for (const row of tablesRes.toArray()) {
                const schema = row.table_schema || 'main';
                const qualified = schema !== 'main'
                    ? `${quoteIdent(schema)}.${quoteIdent(row.table_name)}`
                    : quoteIdent(row.table_name);
                const cntRes = await targetState.conn.query(`SELECT COUNT(*) AS cnt FROM ${qualified};`);
                const rows = Number(cntRes.toArray()[0]?.cnt || 0);
                importedTables.push({ schema, name: row.table_name, rows });
            }
        }

        // Finalize - mark created instance as successfully integrated
        createdInstance = null;
        registeredDbName = null;

        refreshDbSelect(dbName);
        await switchDatabase(dbName);
        emit(Events.SCHEMA_CHANGED);

        // Force checkpoint to persist imported data
        await forceCheckpoint();

        const notification = buildImportNotification(importedTables, dbName, isMerge);
        op.end({
            success: true,
            message: notification.message,
            dismissDelay: NOTIFICATION_TIMING.SUCCESS,
            details: notification.details
        });
    } catch (err) {
        // Clean up on error
        if (createdInstance) {
            try { await disposeDuckDbInstance(createdInstance); } catch { /* ignore */ }
        }
        if (registeredDbName) {
            try { await deleteDatabaseFile(registeredDbName); } catch { /* ignore */ }
            try { unregisterDatabaseState(registeredDbName); } catch { /* ignore */ }
        }

        console.error("Import error:", err);
        op.end({
            success: false,
            message: 'Import failed',
            dismissDelay: NOTIFICATION_TIMING.ERROR,
            details: [err?.message || "Unknown error"]
        });
    }
}
