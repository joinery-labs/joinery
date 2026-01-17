/**
 * Web Config Store Backend
 *
 * This module manages configuration storage for the application when running in the web environment.
 * Configuration data is persisted in the Origin Private File System (OPFS) at `joinery/configs/config.json`.
 */

import { readJsonFile, writeJsonFile } from './opfs-utils.js';

const CONFIG_PATH = 'joinery/configs';
const CONFIG_FILE = 'config.json';

/**
 * Retrieves a configuration value associated with the specified key.
 *
 * @param {string} key - The configuration key to retrieve.
 * @returns {Promise<any>} The value associated with the key, or null if not found.
 */
export async function getConfig(key) {
    const config = await readJsonFile(CONFIG_PATH, CONFIG_FILE);
    return config[key] ?? null;
}

/**
 * Sets a configuration value for the specified key.
 *
 * @param {string} key - The configuration key to set.
 * @param {any} value - The value to store.
 * @returns {Promise<boolean>} True if the operation was successful, false otherwise.
 */
export async function setConfig(key, value) {
    const config = await readJsonFile(CONFIG_PATH, CONFIG_FILE);
    config[key] = value;
    return writeJsonFile(CONFIG_PATH, CONFIG_FILE, config);
}
