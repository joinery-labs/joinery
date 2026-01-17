/**
 * OPFS Utilities
 *
 * Provides utility functions for interacting with the Origin Private File System (OPFS).
 * These utilities facilitate file reading and writing operations for the web backend modules.
 */

/* ============================================================================
 * Directory Access
 * ============================================================================ */

/**
 * Retrieves the root directory handle for the Origin Private File System.
 *
 * @returns {Promise<FileSystemDirectoryHandle>} The root directory handle.
 * @throws {Error} If the Storage Manager API or `getDirectory` is not available in the current browser.
 */
export async function getRootDir() {
    if (!navigator?.storage?.getDirectory) {
        throw new Error('OPFS not available');
    }
    return navigator.storage.getDirectory();
}

/**
 * Retrieves a directory handle for the specified path, optionally creating it if it doesn't exist.
 * This function recursively navigates through the path components.
 *
 * @param {FileSystemDirectoryHandle} root - The root directory handle to start from.
 * @param {string} path - The relative path to the target directory (e.g., 'joinery/configs').
 * @param {boolean} create - If true, missing directories in the path will be created.
 * @returns {Promise<FileSystemDirectoryHandle|null>} The directory handle, or null if it could not be found or created.
 */
export async function getDirectory(root, path, create = false) {
    const parts = path.split('/').filter(p => p);
    let dir = root;
    for (const part of parts) {
        try {
            dir = await dir.getDirectoryHandle(part, { create });
        } catch {
            return null;
        }
    }
    return dir;
}

/* ============================================================================
 * File Operations
 * ============================================================================ */

/**
 * Reads and parses a JSON file from the OPFS.
 *
 * @param {string} dirPath - The directory path containing the file (e.g., 'joinery/configs').
 * @param {string} fileName - The name of the file to read (e.g., 'config.json').
 * @returns {Promise<object>} The parsed JSON object, or an empty object if reading fails.
 */
export async function readJsonFile(dirPath, fileName) {
    try {
        const root = await getRootDir();
        const dir = await getDirectory(root, dirPath, false);
        if (!dir) return {};

        const fileHandle = await dir.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        const content = await file.text();
        return JSON.parse(content);
    } catch {
        return {};
    }
}

/**
 * Writes a JavaScript object as a JSON file to the OPFS.
 * This function ensures that the target directory exists (creating it if necessary) before writing.
 *
 * @param {string} dirPath - The directory path where the file should be written.
 * @param {string} fileName - The name of the file to write.
 * @param {object} data - The data object to be serialized and stored.
 * @returns {Promise<boolean>} True if the write operation was successful, false otherwise.
 */
export async function writeJsonFile(dirPath, fileName, data) {
    try {
        const root = await getRootDir();
        const dir = await getDirectory(root, dirPath, true);
        if (!dir) return false;

        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
        return true;
    } catch (e) {
        console.error(`Error writing ${fileName} to OPFS:`, e);
        return false;
    }
}
