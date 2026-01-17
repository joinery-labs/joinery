/**
 * DuckDB Factory Module
 *
 * Platform-aware factory for creating DuckDB instances.
 * Delegates to WASM backend for web and Rust backend (via Tauri) for desktop.
 */

import { isTauri } from '../platform/environment.js';

// Lazy-loaded backend
let _backend = null;

/**
 * Get the appropriate DuckDB backend for the current platform.
 * @returns {Promise<object>}
 */
async function getBackend() {
    if (_backend) return _backend;

    if (isTauri()) {
        _backend = await import('./duckdb-backends/tauri.js');
    } else {
        _backend = await import('./duckdb-backends/wasm.js');
    }

    return _backend;
}

/**
 * Create a new DuckDB instance.
 * @param {string|null} persistentPath - Optional path for persistent storage (OPFS or filesystem)
 * @returns {Promise<{db, conn, worker?, handle?}>}
 */
export async function createDuckDbInstance(persistentPath = null) {
    const backend = await getBackend();
    return await backend.createInstance(persistentPath);
}

/**
 * Dispose of a DuckDB instance and release resources.
 * @param {object} state - State object from createDuckDbInstance
 */
export async function disposeDuckDbInstance(state) {
    const backend = await getBackend();
    return await backend.disposeInstance(state);
}

/**
 * Drop a file from DuckDB.
 * @param {object} state - Database state
 * @param {string} name - File name
 */
export async function dropFile(state, name) {
    const backend = await getBackend();
    return await backend.dropFile(state, name);
}

/**
 * Copy file from DuckDB to buffer (WASM only).
 * @param {object} state - Database state
 * @param {string} name - File name
 * @returns {Promise<Uint8Array>}
 */
export async function copyFileToBuffer(state, name) {
    const backend = await getBackend();
    return await backend.copyFileToBuffer(state, name);
}

/**
 * Register a file with DuckDB.
 * @param {object} state - Database state
 * @param {string} name - File name
 * @param {File} file - File object
 * @returns {Promise<string|void>} For Tauri: returns path to use in SQL
 */
export async function registerFile(state, name, file) {
    const backend = await getBackend();
    return await backend.registerFile(state, name, file);
}

/**
 * Register a file from a filesystem path (Tauri only).
 * Registers the file without loading it into memory.
 * @param {object} state - Database state
 * @param {string} name - File name for DuckDB registration
 * @param {string} sourcePath - Source file path on filesystem
 * @returns {Promise<string>} Path to use in SQL queries
 * @throws {Error} On Web - use registerFile with File object instead
 */
export async function registerFileFromPath(state, name, sourcePath) {
    const backend = await getBackend();
    return await backend.registerFileFromPath(state, name, sourcePath);
}

/**
 * Get temporary directory path.
 * Returns actual path for Tauri, null for WASM (virtual file system).
 * @param {object} state - Database state
 * @returns {Promise<string|null>} Temp directory path or null for WASM
 */
export async function getTempDirPath(state) {
    const backend = await getBackend();
    return await backend.getTempDirPath(state);
}

/**
 * Build a file path in the temporary directory.
 * @param {string|null} tempDir - Temp directory path
 * @param {string} fileName - File name to append
 * @returns {string} Full path (or just fileName for WASM)
 */
export async function buildTempFilePath(tempDir, fileName) {
    const backend = await getBackend();
    return backend.buildTempFilePath(tempDir, fileName);
}

