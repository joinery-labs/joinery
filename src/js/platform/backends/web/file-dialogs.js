/**
 * Web File Dialogs Backend
 *
 * Implements file dialog interactions for the web environment using standard HTML file inputs
 * for opening files and Blob downloads for saving files.
 */

// A hidden file input element used to trigger the browser's file picker.
let fileInput = null;

/**
 * Retrieves the hidden file input element, creating and appending it to the DOM if necessary.
 *
 * @returns {HTMLInputElement} The file input element.
 */
function getFileInput() {
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
    }
    return fileInput;
}

/**
 * Opens the browser's file picker dialog allowing the user to select one or more files.
 *
 * @param {object} options - Configuration options for the dialog.
 * @param {string[]} [options.extensions] - Allowed file extensions.
 * @param {boolean} [options.multiple=false] - Whether to allow selecting multiple files.
 * @returns {Promise<File[]>} A promise that resolves to an array of File objects selected by the user.
 */
export async function openFileDialog(options = {}) {
    return new Promise((resolve) => {
        const input = getFileInput();

        // Set accept attribute based on extensions
        if (options.extensions && options.extensions.length > 0) {
            input.accept = options.extensions.map(ext => `.${ext}`).join(',');
        } else {
            input.accept = '';
        }

        input.multiple = options.multiple || false;

        // Handle file selection
        const handleChange = () => {
            const files = Array.from(input.files || []);
            input.value = ''; // Reset for next use
            input.removeEventListener('change', handleChange);
            input.removeEventListener('cancel', handleCancel);
            resolve(files);
        };

        // Handle dialog cancel
        const handleCancel = () => {
            input.removeEventListener('change', handleChange);
            input.removeEventListener('cancel', handleCancel);
            resolve([]);
        };

        input.addEventListener('change', handleChange);
        input.addEventListener('cancel', handleCancel);

        // Trigger file picker
        input.click();
    });
}

/**
 * Opens a file picker dialog.
 * Note: Web browsers do not expose absolute file paths due to security restrictions.
 * This function behaves identically to `openFileDialog` and returns File objects instead of paths.
 * Callers should check the platform and handle this limitation accordingly.
 *
 * @param {object} options - Configuration options for the dialog.
 * @param {string[]} [options.extensions] - Allowed file extensions.
 * @param {boolean} [options.multiple=false] - Whether to allow selecting multiple files.
 * @returns {Promise<File[]>} An array of File objects (not paths).
 */
export async function openFileDialogForPaths(options = {}) {
    return openFileDialog(options);
}

/**
 * Triggers a browser download to save data to a file.
 *
 * @param {Blob|Uint8Array|string} data - The content to be saved.
 * @param {object} options - Configuration options for the save operation.
 * @param {string} options.suggestedName - The default filename to suggest in the download dialog.
 * @param {string} [options.mimeType='application/octet-stream'] - The MIME type of the content.
 * @returns {Promise<boolean>} True if the download process was initiated successfully.
 */
export async function saveFileDialog(data, options = {}) {
    try {
        const { suggestedName, mimeType = 'application/octet-stream' } = options;

        // Convert data to Blob if needed
        const blob = data instanceof Blob
            ? data
            : new Blob([data], { type: mimeType });

        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = suggestedName || 'download';

        document.body.appendChild(a);
        a.click();

        // Cleanup
        URL.revokeObjectURL(url);
        a.remove();

        return true;
    } catch (e) {
        console.error('saveFileDialog error:', e);
        return false;
    }
}

/**
 * Initiates a direct file download.
 * In the web environment, this is functionally equivalent to `saveFileDialog`.
 *
 * @param {Blob|Uint8Array|string} data - The content to download.
 * @param {string} mimeType - The MIME type of the content.
 * @param {string} filename - The filename for the download.
 * @returns {Promise<boolean>} True if the download was initiated successfully.
 */
export async function downloadFile(data, mimeType, filename) {
    return saveFileDialog(data, { suggestedName: filename, mimeType });
}
