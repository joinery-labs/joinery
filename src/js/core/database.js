/**
 * Database Management Module
 *
 * Handles DuckDB initialization, connection management, and multi-database state.
 * Uses persistent storage (OPFS for web, AppData for Tauri) for automatic data persistence.
 */

import { startNotification, NOTIFICATION_TIMING } from '../ui/notification-panel.js';
import { createDuckDbInstance, disposeDuckDbInstance } from './duckdb-factory.js';
import { emit, Events } from './event-bus.js';
import { getDatabasePath, deleteDatabaseFile, hasPersistentStorage, listDatabaseFiles } from '../platform/database-path.js';
import { initCheckpointManager, resetCheckpointState, forceCheckpoint } from './checkpoint-manager.js';

// ============================================================================
// Database State Management
// ============================================================================

// Map<string, { db, conn, worker, persistentPath }>
const dbStates = new Map();
let activeDbName = null;
let conn = null; // Current active connection

// TreeSelect getter (registered by main.js to avoid circular dependency)
let _dbTreeSelectGetter = null;

/**
 * Register the database TreeSelect getter function.
 * Called by main.js after creating the TreeSelect instance.
 * @param {Function} getter - Function that returns the TreeSelect instance
 */
export function setDbTreeSelectGetter(getter) {
    _dbTreeSelectGetter = getter;
}

// ============================================================================
// Public Getters
// ============================================================================


export function getConn() {
    return conn;
}

export function getActiveDbName() {
    return activeDbName;
}

/**
 * Get the active database state object.
 * Provides access to the underlying DuckDB instance, connection, and worker.
 * @returns {object|null} State object with db, conn, worker, handle, etc.
 */
export function getActiveDbState() {
    if (!activeDbName) return null;
    return dbStates.get(activeDbName) || null;
}

/**
 * Check if a database exists.
 * @param {string} name - Database name
 * @returns {boolean}
 */
export function hasDatabase(name) {
    return dbStates.has(name);
}

/**
 * Get database state by name.
 * @param {string} name - Database name
 * @returns {object|null} State object or null if not found
 */
export function getDatabaseState(name) {
    return dbStates.get(name) || null;
}

/**
 * Register a new database state.
 * @param {string} name - Database name
 * @param {object} stateObj - State object
 */
export function registerDatabaseState(name, stateObj) {
    dbStates.set(name, stateObj);
}

/**
 * Unregister a database state.
 * Removes from state matching without disposal (used for cleanup).
 * @param {string} name - Database name
 */
export function unregisterDatabaseState(name) {
    dbStates.delete(name);
}

// ============================================================================
// Database Instance Management
// ============================================================================

/**
 * Create a new database instance with persistent storage.
 * @param {string} name - Database name
 * @returns {Promise<{db, conn}>}
 */
async function createNewDatabase(name) {
    // Get platform-specific persistent path
    const persistentPath = hasPersistentStorage() ? await getDatabasePath(name) : null;

    const { db: dbInstance, conn: connection, worker, handle } = await createDuckDbInstance(persistentPath);

    dbStates.set(name, {
        db: dbInstance,
        conn: connection,
        worker,
        handle,
        persistentPath
    });

    return { db: dbInstance, conn: connection };
}

// ============================================================================
// Database Switching
// ============================================================================

/**
 * Switch active database.
 * @param {string} name - Database name
 */
export async function switchDatabase(name) {
    const state = dbStates.get(name);
    if (!state) throw new Error(`Database "${name}" does not exist`);

    // Checkpoint current database before switching
    if (activeDbName && activeDbName !== name && conn) {
        await forceCheckpoint();
    }

    activeDbName = name;
    conn = state.conn;

    // Reset checkpoint state for the new active database
    resetCheckpointState();

    // Notify subscribers
    emit(Events.DATABASE_SWITCHED);
}

/**
 * Refresh database selector dropdown.
 * @param {string} selectName - Name to select
 */
export function refreshDbSelect(selectName) {
    const treeSelect = _dbTreeSelectGetter?.();
    if (!treeSelect) return;

    const data = [];
    for (const key of dbStates.keys()) {
        data.push({ id: key, label: key });
    }

    treeSelect.setData(data);

    if (selectName && dbStates.has(selectName)) {
        treeSelect.setValue(selectName);
    }
}

/**
 * Delete database completely.
 * Removes all files, cleans up state, and switches to default.
 * @param {string} name - Database name
 */
export async function deleteDatabase(name) {
    const state = dbStates.get(name);
    if (!state) throw new Error(`Database "${name}" does not exist`);

    // Step 1: Clean up existing resources
    await disposeDuckDbInstance(state);

    // Step 2: Remove from state map
    dbStates.delete(name);

    // Step 3: Delete the database file from persistent storage
    if (state.persistentPath) {
        await deleteDatabaseFile(name);
    }

    // Step 4: Handle default database recreation or switch
    if (name === 'default') {
        // Recreate default database and set as active
        await createNewDatabase('default');
        await switchDatabase('default');
        refreshDbSelect('default');
    } else {
        // Switch to default (must always exist)
        await switchDatabase('default');
        refreshDbSelect('default');
    }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize database system.
 * Loads all persisted databases and ensures default exists.
 */
export async function initDatabase() {
    const op = startNotification({
        title: 'Initializing Database',
        status: 'Starting DuckDB...'
    });

    try {
        const hasPersistence = hasPersistentStorage();

        if (!hasPersistence) {
            op.update({ status: 'No persistent storage available...' });
        }

        // Discover existing persisted databases
        let persistedDbNames = [];
        if (hasPersistence) {
            op.update({ status: 'Discovering databases...' });
            persistedDbNames = await listDatabaseFiles();
        }

        // Ensure 'default' is always first
        if (!persistedDbNames.includes('default')) {
            persistedDbNames.unshift('default');
        } else {
            // Move 'default' to front if it exists elsewhere
            persistedDbNames = ['default', ...persistedDbNames.filter(n => n !== 'default')];
        }

        // Load all databases
        for (let i = 0; i < persistedDbNames.length; i++) {
            const name = persistedDbNames[i];
            op.update({ status: `Loading database ${i + 1}/${persistedDbNames.length}: ${name}...` });
            await createNewDatabase(name);
        }

        // Set default as active
        activeDbName = "default";
        const defaultState = dbStates.get("default");
        conn = defaultState.conn;

        // Initialize checkpoint manager
        initCheckpointManager();

        refreshDbSelect("default");

        const dbCount = persistedDbNames.length;
        if (hasPersistence) {
            const msg = dbCount > 1
                ? `Loaded ${dbCount} databases (auto-save enabled)`
                : 'Database ready (auto-save enabled)';
            op.end({ success: true, message: msg, dismissDelay: NOTIFICATION_TIMING.SUCCESS });
        } else {
            op.end({ success: true, message: 'Database ready (no persistence)', dismissDelay: NOTIFICATION_TIMING.WARNING });
        }
    } catch (e) {
        op.end({ success: false, message: 'Init failed', dismissDelay: NOTIFICATION_TIMING.ERROR });
        console.error("DuckDB init error:", e);
        throw e;
    }
}
