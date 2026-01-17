/**
 * DuckDB WASM Backend
 *
 * Backend implementation for web browser environments using @duckdb/duckdb-wasm.
 */

import * as duckdb from '@duckdb/duckdb-wasm';

// Local DuckDB-WASM assets (bundled by Vite using ?url suffix)
import duckdb_mvp_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdb_mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_eh_wasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdb_eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

let _cachedBundle = null;

// ============================================================================
// Bundle Selection
// ============================================================================

// Manual bundle configuration using local assets (no CDN)
const MANUAL_BUNDLES = {
    mvp: {
        mainModule: duckdb_mvp_wasm,
        mainWorker: duckdb_mvp_worker,
    },
    eh: {
        mainModule: duckdb_eh_wasm,
        mainWorker: duckdb_eh_worker,
    },
};

/**
 * Select optimal bundle based on browser capabilities.
 * @returns {Promise<object>} Selected bundle configuration
 */
async function getSelectedBundle() {
    if (_cachedBundle) return _cachedBundle;

    // Check if browser supports WebAssembly exception handling
    const features = await duckdb.getPlatformFeatures();
    if (features.wasmExceptions && MANUAL_BUNDLES.eh) {
        _cachedBundle = MANUAL_BUNDLES.eh;
    } else {
        _cachedBundle = MANUAL_BUNDLES.mvp;
    }

    return _cachedBundle;
}

/**
 * Initialize DuckDB WASM instance.
 * @param {string|null} persistentPath - Optional path for persistent storage (opfs://)
 * @returns {Promise<{db, conn, worker, handle: null}>}
 */
export async function createInstance(persistentPath = null) {
    const bundle = await getSelectedBundle();

    // Create worker directly from local bundled file
    const worker = new Worker(bundle.mainWorker, { type: 'module' });
    const logger = new duckdb.ConsoleLogger();

    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    // Open with persistent path if provided
    if (persistentPath) {
        await db.open({
            path: persistentPath,
            accessMode: duckdb.DuckDBAccessMode.READ_WRITE
        });
    }

    // Create single connection
    const conn = await db.connect();

    // Workaround for DuckDB-WASM OPFS write mode bug
    // Forces write mode activation by creating/dropping a temp table
    if (persistentPath) {
        const tempName = `__opfs_init_${Date.now()}`;
        try {
            await conn.query(`CREATE OR REPLACE TABLE "${tempName}" AS SELECT 1;`);
            await conn.query(`DROP TABLE "${tempName}";`);
        } catch {
            // Ignore (best-effort workaround)
        }
    }

    return { db, conn, worker, handle: null };
}

/**
 * Dispose of DuckDB WASM instance.
 * @param {object} state - State object from createInstance
 */
export async function disposeInstance(state) {
    if (!state) return;

    // Close connection first
    if (state.conn) {
        try { await state.conn.close(); } catch { /* ignore */ }
    }

    // Terminate database
    if (state.db) {
        try { await state.db.terminate(); } catch { /* ignore */ }
    }

    // Terminate worker
    if (state.worker) {
        try { state.worker.terminate(); } catch { /* ignore */ }
    }
}

/**
 * Copy file from VFS to buffer.
 * @param {object} state - Database state
 * @param {string} name - File name
 * @returns {Promise<Uint8Array>}
 */
export async function copyFileToBuffer(state, name) {
    return await state.db.copyFileToBuffer(name);
}

/**
 * Drop a file from DuckDB VFS.
 * @param {object} state - Database state
 * @param {string} name - File name
 */
export async function dropFile(state, name) {
    try {
        await state.db.dropFile(name);
    } catch {
        // Intentionally ignored: file may not exist
    }
}

/**
 * Register a File object with DuckDB.
 * Uses FileReader bridge or falls back to buffer.
 * @param {object} state - Database state
 * @param {string} name - File name
 * @param {File} file - File object
 */
export async function registerFile(state, name, file) {
    const proto = duckdb.DuckDBDataProtocol?.BROWSER_FILEREADER;

    if (typeof proto === 'number') {
        try {
            await state.db.registerFileHandle(name, file, proto, true);
            return;
        } catch (e) {
            const msg = e?.message || '';
            // Only fall back if protocol is unsupported
            if (!/protocol|BROWSER_FILEREADER|registerFileHandle/i.test(msg)) throw e;
        }
    }

    // Fallback: copy to memory buffer
    const buf = new Uint8Array(await file.arrayBuffer());
    await state.db.registerFileBuffer(name, buf);
}

/**
 * Register a file from a filesystem path.
 * Not supported on Web.
 * @throws {Error} Always throws
 */
export async function registerFileFromPath() {
    throw new Error('registerFileFromPath is not supported on Web. Use registerFile with a File object.');
}

/**
 * Get temporary directory path.
 * Returns null for WASM (uses internal VFS).
 * @param {object} state - Database state
 * @returns {Promise<null>} Always null for WASM
 */
export async function getTempDirPath(state) {
    return null;
}

/**
 * Build file path for internal VFS.
 * @param {string} tempDir - Unused for WASM
 * @param {string} fileName - File name
 * @returns {string} The fileName (flat namespace)
 */
export function buildTempFilePath(tempDir, fileName) {
    return fileName;
}

