/**
 * Tauri File System Utilities
 *
 * Provides shared utility functions for filesystem operations within the Tauri environment.
 * These utilities are used by backend modules to ensure consistent file handling and path management.
 */

/* ============================================================================
 * Module Loading
 * ============================================================================ */

let fs = null;
let path = null;

/**
 * Retrieves the Tauri filesystem and path modules, loading them lazily on first use.
 * This prevents import errors when the code is not running in a Tauri environment.
 *
 * @returns {Promise<{fs: object, path: object}>} An object containing the `fs` and `path` modules.
 */
export async function getTauriModules() {
    if (!fs) {
        const fsModule = await import('@tauri-apps/plugin-fs');
        const pathModule = await import('@tauri-apps/api/path');
        fs = fsModule;
        path = pathModule;
    }
    return { fs, path };
}

/* ============================================================================
 * Path Utilities
 * ============================================================================ */

/**
 * Constructs a full path within the application's data directory.
 *
 * @param {...string} parts - Path segments to join (e.g., 'joinery', 'configs', 'config.json').
 * @returns {Promise<string>} The absolute path.
 */
export async function getAppDataPath(...parts) {
    const { path } = await getTauriModules();
    const appDataDir = await path.appDataDir();
    return await path.join(appDataDir, ...parts);
}

/**
 * Ensures that a directory exists at the specified path.
 * If the directory does not exist, it (and any missing parent directories) will be created.
 *
 * @param {string} dirPath - The directory path to check/create.
 * @returns {Promise<boolean>} True if the directory exists or was successfully created.
 */
export async function ensureDirectory(dirPath) {
    const { fs } = await getTauriModules();

    try {
        const exists = await fs.exists(dirPath);
        if (!exists) {
            await fs.mkdir(dirPath, { recursive: true });
        }
        return true;
    } catch (e) {
        console.error('Error creating directory:', e);
        return false;
    }
}

/* ============================================================================
 * JSON File Operations
 * ============================================================================ */

/**
 * Reads and parses a JSON file from the application data directory.
 *
 * @param {...string} pathParts - Path segments describing the file location.
 * @returns {Promise<object>} The parsed JSON object, or an empty object if the file doesn't exist or an error occurs.
 */
export async function readJsonFile(...pathParts) {
    try {
        const { fs } = await getTauriModules();
        const filePath = await getAppDataPath(...pathParts);

        const exists = await fs.exists(filePath);
        if (!exists) return {};

        const content = await fs.readTextFile(filePath);
        return JSON.parse(content);
    } catch (e) {
        console.warn('Error reading JSON file:', e);
        return {};
    }
}

/**
 * Writes a JavaScript object as a JSON file to the application data directory.
 * This function also ensures that the parent directory exists before writing.
 *
 * @param {object} data - The data object to serialize and write.
 * @param {...string} pathParts - Path segments describing the file location.
 * @returns {Promise<boolean>} True if the operation was successful.
 */
export async function writeJsonFile(data, ...pathParts) {
    try {
        const { fs } = await getTauriModules();
        const filePath = await getAppDataPath(...pathParts);

        // Ensure parent directory exists
        const dirParts = pathParts.slice(0, -1);
        if (dirParts.length > 0) {
            const dirPath = await getAppDataPath(...dirParts);
            await ensureDirectory(dirPath);
        }

        await fs.writeTextFile(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error('Error writing JSON file:', e);
        return false;
    }
}
