/**
 * Database Path Resolution
 *
 * Determines the appropriate database file paths for each platform:
 * - Web: opfs://joinery/databases/{name}.db
 * - Tauri: {AppDataDir}/joinery/databases/{name}.db
 */

import { isTauri } from './environment.js';

// Lazily loaded modules
let pathModule = null;
let fsModule = null;

// Database directory path (relative to OPFS root for web)
const DB_DIR = 'joinery/databases';
const DB_DIR_PARTS = DB_DIR.split('/');

/**
 * Sanitizes a database name for filesystem safety.
 * 
 * @param {string} dbName - The raw database name.
 * @returns {string} Safe name containing only alphanumeric characters, underscores, and hyphens.
 */
function sanitizeName(dbName) {
    return dbName.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Resolves the database path for a given database name.
 * 
 * @param {string} dbName - The database name (without extension).
 * @returns {Promise<string>} The platform-specific path suitable for DuckDB.
 */
export async function getDatabasePath(dbName) {
    const safeName = sanitizeName(dbName);

    if (isTauri()) {
        if (!pathModule) {
            pathModule = await import('@tauri-apps/api/path');
        }
        const appData = await pathModule.appDataDir();
        return await pathModule.join(appData, DB_DIR, `${safeName}.db`);
    } else {
        // Web: use opfs:// prefix for DuckDB-WASM
        return `opfs://${DB_DIR}/${safeName}.db`;
    }
}

/**
 * Deletes a database file from persistent storage.
 * 
 * @param {string} dbName - The database name (without extension).
 * @returns {Promise<boolean>} True if the file was deleted successfully.
 */
export async function deleteDatabaseFile(dbName) {
    const safeName = sanitizeName(dbName);

    if (isTauri()) {
        // Tauri: delete via filesystem API
        if (!pathModule) {
            pathModule = await import('@tauri-apps/api/path');
        }
        if (!fsModule) {
            fsModule = await import('@tauri-apps/plugin-fs');
        }

        try {
            const appData = await pathModule.appDataDir();
            const dbPath = await pathModule.join(appData, DB_DIR, `${safeName}.db`);

            if (await fsModule.exists(dbPath)) {
                await fsModule.remove(dbPath);
            }

            // Also try to remove WAL and SHM files if they exist
            const walPath = `${dbPath}.wal`;
            const shmPath = `${dbPath}.shm`;
            if (await fsModule.exists(walPath)) await fsModule.remove(walPath);
            if (await fsModule.exists(shmPath)) await fsModule.remove(shmPath);

            return true;
        } catch (e) {
            console.warn(`Failed to delete database file "${safeName}":`, e);
            return false;
        }
    } else {
        // Web: delete from OPFS
        try {
            const root = await navigator.storage.getDirectory();

            // Navigate to database directory
            let dir = root;
            for (const part of DB_DIR_PARTS) {
                dir = await dir.getDirectoryHandle(part, { create: false });
            }

            // Delete the database file and any associated files
            // Note: Errors expected if files don't exist (not created yet or already cleaned)
            const fileName = `${safeName}.db`;
            try { await dir.removeEntry(fileName); } catch { /* file may not exist */ }
            try { await dir.removeEntry(`${fileName}.wal`); } catch { /* file may not exist */ }
            try { await dir.removeEntry(`${fileName}.shm`); } catch { /* file may not exist */ }

            return true;
        } catch (e) {
            console.warn(`Failed to delete database file "${safeName}":`, e);
            return false;
        }
    }
}

/**
 * Retrieves a handle or reference to the database file for streaming operations.
 * 
 * - Web: Returns a FileSystemFileHandle from OPFS (use .getFile() to stream).
 * - Tauri: Returns the file path as a string.
 * 
 * @param {string} dbName - The database name (without extension).
 * @returns {Promise<FileSystemFileHandle|string>} A file handle (Web) or file path (Tauri).
 */
export async function getDatabaseFileHandle(dbName) {
    const safeName = sanitizeName(dbName);

    if (isTauri()) {
        // Tauri: return the database file path
        if (!pathModule) {
            pathModule = await import('@tauri-apps/api/path');
        }
        const appData = await pathModule.appDataDir();
        return await pathModule.join(appData, DB_DIR, `${safeName}.db`);
    } else {
        // Web: return OPFS file handle for streaming
        const root = await navigator.storage.getDirectory();

        // Navigate to database directory
        let dir = root;
        for (const part of DB_DIR_PARTS) {
            dir = await dir.getDirectoryHandle(part, { create: false });
        }

        // Return file handle (caller can use .getFile() for streaming)
        const fileName = `${safeName}.db`;
        return await dir.getFileHandle(fileName);
    }
}

/**
 * Copies or streams a database file to persistent storage.
 * 
 * - Web: Streams the File directly to OPFS using pipeTo (constant memory usage).
 * - Tauri: Copies the file at the filesystem level using fs.copyFile.
 * 
 * @param {string} dbName - The database name (without extension).
 * @param {File|null} file - The source File object (required for Web).
 * @param {string|null} sourcePath - The source file path (required for Tauri).
 * @returns {Promise<void>}
 */
export async function copyDatabaseFile(dbName, file, sourcePath) {
    const safeName = sanitizeName(dbName);

    if (isTauri()) {
        // Tauri: copy at filesystem level (zero JS memory)
        if (!pathModule) {
            pathModule = await import('@tauri-apps/api/path');
        }
        if (!fsModule) {
            fsModule = await import('@tauri-apps/plugin-fs');
        }

        const appData = await pathModule.appDataDir();
        const dbDir = await pathModule.join(appData, DB_DIR);

        // Ensure directory exists
        try {
            await fsModule.mkdir(dbDir, { recursive: true });
        } catch { /* ignore if exists */ }

        const destPath = await pathModule.join(dbDir, `${safeName}.db`);
        await fsModule.copyFile(sourcePath, destPath);
    } else {
        // Web: stream directly to OPFS (constant memory)
        const root = await navigator.storage.getDirectory();

        // Navigate/create database directory
        let dir = root;
        for (const part of DB_DIR_PARTS) {
            dir = await dir.getDirectoryHandle(part, { create: true });
        }

        // Stream file to OPFS
        const fileName = `${safeName}.db`;
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await file.stream().pipeTo(writable);
    }
}

/**
 * Checks if persistent storage is available.
 * 
 * @returns {boolean} True if persistent storage is supported.
 */
export function hasPersistentStorage() {
    if (isTauri()) {
        return true; // Tauri always has filesystem access
    }
    return !!(navigator?.storage?.getDirectory);
}

/**
 * Lists all database files currently in persistent storage.
 * 
 * @returns {Promise<string[]>} An array of database names (excluding the .db extension).
 */
export async function listDatabaseFiles() {
    if (isTauri()) {
        if (!pathModule) {
            pathModule = await import('@tauri-apps/api/path');
        }
        if (!fsModule) {
            fsModule = await import('@tauri-apps/plugin-fs');
        }

        try {
            const appData = await pathModule.appDataDir();
            const dbDir = await pathModule.join(appData, DB_DIR);

            // Check if directory exists
            if (!await fsModule.exists(dbDir)) {
                return [];
            }

            const entries = await fsModule.readDir(dbDir);
            const dbNames = [];

            for (const entry of entries) {
                // Only include .db files (exclude .wal and .shm which don't match anyway)
                if (entry.name && entry.name.endsWith('.db')) {
                    // Remove .db extension to get database name
                    dbNames.push(entry.name.slice(0, -3));
                }
            }

            return dbNames;
        } catch (e) {
            console.warn('Failed to list database files:', e);
            return [];
        }
    } else {
        // Web: list from OPFS
        try {
            const root = await navigator.storage.getDirectory();

            // Navigate to database directory
            let dir = root;
            for (const part of DB_DIR_PARTS) {
                dir = await dir.getDirectoryHandle(part, { create: false });
            }

            const dbNames = [];
            for await (const [name, handle] of dir.entries()) {
                if (handle.kind === 'file' && name.endsWith('.db')) {
                    // Remove .db extension to get database name
                    dbNames.push(name.slice(0, -3));
                }
            }

            return dbNames;
        } catch (e) {
            // Directory doesn't exist yet - that's fine
            if (e.name !== 'NotFoundError') {
                console.warn('Failed to list database files:', e);
            }
            return [];
        }
    }
}
