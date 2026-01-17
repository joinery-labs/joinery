/**
 * Tauri File Dialogs Backend
 * Uses native file dialogs via @tauri-apps/plugin-dialog
 */

// Lazily loaded Tauri modules to improve initial load performance.
let dialog = null;
let fs = null;

/**
 * Initializes the Tauri dialog and filesystem modules if they haven't been loaded yet.
 * This function ensures that the modules are available before any file operations are attempted.
 */
async function initTauriModules() {
    if (!dialog) {
        const dialogModule = await import('@tauri-apps/plugin-dialog');
        const fsModule = await import('@tauri-apps/plugin-fs');
        dialog = dialogModule;
        fs = fsModule;
    }
}

/**
 * Constructs file filter objects compatible with Tauri's dialog API from a list of extensions.
 *
 * @param {string[]} extensions - An array of allowed file extensions (e.g., ['json', 'txt']).
 * @returns {Array<{name: string, extensions: string[]}>} An array of filter objects.
 */
function buildFilters(extensions) {
    if (!extensions || extensions.length === 0) {
        return [];
    }

    return [{
        name: 'Supported Files',
        extensions: extensions.map(ext => ext.replace(/^\./, ''))
    }];
}

/**
 * Opens a system file picker dialog allowing the user to select one or more files.
 * The selected files are read and returned as standard File objects.
 *
 * @param {object} options - Configuration options for the dialog.
 * @param {string[]} [options.extensions] - Allowed file extensions.
 * @param {boolean} [options.multiple=false] - Whether to allow selecting multiple files.
 * @param {string} [options.title] - Custom title for the dialog window.
 * @returns {Promise<File[]>} A promise that resolves to an array of File objects.
 */
export async function openFileDialog(options = {}) {
    try {
        await initTauriModules();

        const dialogOptions = {
            multiple: options.multiple || false,
            title: options.title || 'Open File',
            filters: buildFilters(options.extensions)
        };

        const result = await dialog.open(dialogOptions);

        if (!result) return [];

        // Normalize to array
        const paths = Array.isArray(result) ? result : [result];

        // Read files and convert to File objects
        const files = await Promise.all(paths.map(async (filePath) => {
            const content = await fs.readFile(filePath);
            const name = filePath.split(/[/\\]/).pop();
            return new File([content], name);
        }));

        return files;
    } catch (e) {
        console.error('openFileDialog error:', e);
        return [];
    }
}

/**
 * Opens a system file picker dialog and returns the absolute paths of the selected files.
 * This is preferred for operations requiring direct filesystem access (e.g., copying files)
 * to avoid loading large file contents into memory.
 *
 * @param {object} options - Configuration options for the dialog.
 * @param {string[]} [options.extensions] - Allowed file extensions.
 * @param {boolean} [options.multiple=false] - Whether to allow selecting multiple files.
 * @param {string} [options.title] - Custom title for the dialog window.
 * @returns {Promise<string[]>} A promise that resolves to an array of absolute file paths.
 */
export async function openFileDialogForPaths(options = {}) {
    try {
        await initTauriModules();

        const dialogOptions = {
            multiple: options.multiple || false,
            title: options.title || 'Open File',
            filters: buildFilters(options.extensions)
        };

        const result = await dialog.open(dialogOptions);

        if (!result) return [];

        // Return paths directly without reading file contents
        return Array.isArray(result) ? result : [result];
    } catch (e) {
        console.error('openFileDialogForPaths error:', e);
        return [];
    }
}

/**
 * Opens a system save dialog to save data to a file.
 *
 * @param {Blob|Uint8Array|string} data - The content to be saved.
 * @param {object} options - Configuration options for the save operation.
 * @param {string} options.suggestedName - The default filename to suggest in the dialog.
 * @param {string} [options.title] - Custom title for the dialog window.
 * @param {string[]} [options.extensions] - Allowed file extensions.
 * @returns {Promise<boolean>} True if the file was saved successfully, false otherwise.
 */
export async function saveFileDialog(data, options = {}) {
    try {
        await initTauriModules();

        const dialogOptions = {
            defaultPath: options.suggestedName,
            title: options.title || 'Save File',
            filters: buildFilters(options.extensions)
        };

        const filePath = await dialog.save(dialogOptions);

        if (!filePath) return false;

        // Convert data to appropriate format
        let content;
        if (data instanceof Blob) {
            const buffer = await data.arrayBuffer();
            content = new Uint8Array(buffer);
        } else if (typeof data === 'string') {
            content = data;
        } else {
            content = data;
        }

        if (typeof content === 'string') {
            await fs.writeTextFile(filePath, content);
        } else {
            await fs.writeFile(filePath, content);
        }

        return true;
    } catch (e) {
        console.error('saveFileDialog error:', e);
        return false;
    }
}

/**
 * Initiates a file download. In the Tauri context, this uses the system save dialog.
 *
 * @param {Blob|Uint8Array|string} data - The content to download.
 * @param {string} mimeType - The MIME type of the content (unused in Tauri backend but kept for API consistency).
 * @param {string} filename - The suggested filename.
 * @returns {Promise<boolean>} True if the download/save was successful.
 */
export async function downloadFile(data, mimeType, filename) {
    return saveFileDialog(data, { suggestedName: filename });
}
