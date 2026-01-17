/**
 * DuckDB Tauri Backend
 *
 * Uses native Rust DuckDB with Arrow IPC for performance.
 * Query results are returned as Arrow IPC streams.
 */

import { invoke } from '@tauri-apps/api/core';
import { tableFromIPC } from 'apache-arrow';

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Wrap errors from Tauri invoke to ensure proper Error objects.
 * Handles string errors and errors without message properties.
 * @param {*} error - Error from Tauri invoke
 * @returns {Error} Proper Error object
 */
function wrapError(error) {
    if (error instanceof Error) {
        return error;
    }
    if (typeof error === 'string') {
        return new Error(error);
    }
    if (error && typeof error.message === 'string') {
        return new Error(error.message);
    }
    return new Error(String(error ?? 'Unknown error'));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a new DuckDB instance (Rust backend).
 * @param {string|null} persistentPath - Filesystem path for persistent storage
 * @returns {Promise<{db: null, conn: object, worker: null, handle: number}>}
 */
export async function createInstance(persistentPath = null) {
    try {
        const handle = await invoke('duckdb_open', { path: persistentPath });

        // Create connection wrapper with .query() method for API compatibility
        const conn = createConnectionWrapper(handle);

        // Return state object matching WASM interface
        return { db: null, conn, worker: null, handle };
    } catch (e) {
        throw wrapError(e);
    }
}

/**
 * Close and dispose a DuckDB instance.
 * @param {object} state - State object from createInstance
 */
export async function disposeInstance(state) {
    if (!state?.handle) return;

    try {
        await invoke('duckdb_close', { handle: state.handle });
    } catch (e) {
        console.warn('DuckDB close warning:', e);
    }
}

/**
 * Drop a file.
 * @param {object} state - Database state
 * @param {string} name - File name (relative or absolute)
 */
export async function dropFile(state, name) {
    if (!state?.handle) return;

    try {
        await invoke('duckdb_drop_file', { handle: state.handle, name });
    } catch {
        // Intentionally ignored: file may not exist
    }
}

/**
 * Copy file to buffer - NOT USED for Tauri exports.
 * Tauri writes directly to disk via save dialog.
 * @throws {Error} Always throws
 */
export async function copyFileToBuffer(state, name) {
    throw new Error('copyFileToBuffer is not used on Tauri. Use direct COPY TO with save dialog instead.');
}

/**
 * Register a File object with DuckDB.
 * Uses filesystem-based registration to avoid base64 overhead.
 * @param {object} state - Database state
 * @param {string} name - File name
 * @param {File} file - File object
 * @returns {Promise<string>} Path to use in SQL queries
 */
export async function registerFile(state, name, file) {
    return await registerFilePath(state, name, file);
}

/**
 * Register a file from a filesystem path (memory-efficient).
 * Registers the file without loading into JS memory.
 * @param {object} state - Database state
 * @param {string} name - File name for DuckDB registration
 * @param {string} sourcePath - Source file path on filesystem
 * @returns {Promise<string>} Path to use in SQL queries
 */
export async function registerFileFromPath(state, name, sourcePath) {
    if (!state?.handle) throw new Error('Invalid database state');

    try {
        // Register with Rust backend directly from source path
        const registeredPath = await invoke('duckdb_register_file_path', {
            handle: state.handle,
            sourcePath,
            name
        });

        return registeredPath;
    } catch (e) {
        throw wrapError(e);
    }
}

/**
 * Register a file by writing to temp and copying via Rust.
 * Avoids base64 encoding overhead when transferring to Rust.
 * @param {object} state - Database state
 * @param {string} name - Target file name
 * @param {File} file - Source File object
 * @returns {Promise<string>} Path to use in SQL queries
 */
async function registerFilePath(state, name, file) {
    if (!state?.handle) throw new Error('Invalid database state');

    // Get Tauri modules for writing temp file
    const { writeFile, remove } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');

    // Get allowed temp directory from Rust backend
    const tempDirPath = await invoke('duckdb_get_uploads_dir');
    const tempFilePath = await join(tempDirPath, `upload_${Date.now()}_${name}`);

    try {
        // Read file as array buffer and write to temp location
        const fileData = new Uint8Array(await file.arrayBuffer());
        await writeFile(tempFilePath, fileData);

        // Register with Rust backend (copies to DuckDB's temp dir)
        const registeredPath = await invoke('duckdb_register_file_path', {
            handle: state.handle,
            sourcePath: tempFilePath,
            name
        });

        return registeredPath;
    } catch (e) {
        throw wrapError(e);
    } finally {
        // Clean up temp file
        try {
            await remove(tempFilePath);
        } catch { /* ignore cleanup errors */ }
    }
}


/**
 * Get the temp directory path for COPY TO operations.
 * Returns the path where DuckDB can write export files.
 * @param {object} state - Database state
 * @returns {Promise<string>} Temp directory path
 */
export async function getTempDirPath(state) {
    if (!state?.handle) throw new Error('Invalid database state');

    try {
        return await invoke('duckdb_get_temp_dir', { handle: state.handle });
    } catch (e) {
        throw wrapError(e);
    }
}

/**
 * Build a file path in the temp directory.
 * @param {string} tempDir - Temp directory path from getTempDirPath
 * @param {string} fileName - File name to append
 * @returns {string} Full path
 */
export function buildTempFilePath(tempDir, fileName) {
    // Normalize backslashes (Windows) to forward slashes for DuckDB
    const normalizedDir = tempDir.replace(/\\/g, '/');
    return `${normalizedDir}/${fileName}`;
}


// ============================================================================
// Connection Wrapper
// ============================================================================

/**
 * Create a connection wrapper mimicking WASM AsyncDuckDBConnection.
 * @param {number} handle - Rust DuckDB handle
 * @returns {object} Connection-like object with .query() method
 */
function createConnectionWrapper(handle) {
    return {
        _handle: handle,

        async query(sql) {
            let ipcBuffer;
            try {
                // Get raw Arrow IPC bytes from Rust
                ipcBuffer = await invoke('duckdb_query', { handle, sql });
            } catch (e) {
                throw wrapError(e);
            }

            try {
                // Parse Arrow IPC to Table
                const ipcBytes = new Uint8Array(ipcBuffer);
                return tableFromIPC(ipcBytes);
            } catch (e) {
                const msg = e?.message || String(e);
                throw new Error(`Arrow IPC parse error: ${msg}`);
            }
        },

        async close() {
            // No-op - closing is handled by disposeInstance
        },

        /**
         * Insert Arrow table data from IPC stream.
         * Uses native Rust Arrow support for efficient bulk insertion.
         * @param {Uint8Array} ipcData - Serialized Arrow IPC stream data
         * @param {object} options - Options with table name
         * @param {string} options.name - Target table name
         */
        async insertArrowFromIPCStream(ipcData, options) {
            let dataB64;
            try {
                dataB64 = uint8ArrayToBase64(ipcData);
            } catch (e) {
                const msg = e?.message || String(e);
                throw new Error(`Arrow IPC encode error: ${msg}`);
            }

            try {
                await invoke('duckdb_insert_arrow_ipc', {
                    handle,
                    table: options.name,
                    dataB64
                });
            } catch (e) {
                throw wrapError(e);
            }
        }
    };
}

// ============================================================================
// Base64 Encoding Utilities
// ============================================================================

/**
 * Convert Uint8Array to base64 string.
 * Uses chunked encoding to avoid stack overflow.
 * @param {Uint8Array} bytes - Binary data
 * @returns {string} Base64-encoded string
 */
function uint8ArrayToBase64(bytes) {
    const CHUNK_SIZE = 0x8000; // 32KB chunks
    let result = '';
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        const chunk = bytes.subarray(i, i + CHUNK_SIZE);
        result += String.fromCharCode.apply(null, chunk);
    }
    return btoa(result);
}

