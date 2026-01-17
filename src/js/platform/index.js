/**
 * Platform Module
 * 
 * Central export point for all platform abstraction APIs.
 */

// Environment detection
export { isTauri, isWeb, logEnvironment } from './environment.js';

// Configuration storage (e.g., store user preferences)
export { getConfig, setConfig } from './config-store.js';

// Saved queries storage
export {
    getSavedQueries,
    setSavedQueries,
    addSavedQuery,
    updateSavedQuery,
    deleteSavedQuery
} from './saved-queries-store.js';


// Database path resolution
export { getDatabasePath, deleteDatabaseFile, getDatabaseFileHandle, copyDatabaseFile, hasPersistentStorage, listDatabaseFiles } from './database-path.js';

// File dialogs (import/export operations)
export { openFileDialog, openFileDialogForPaths, saveFileDialog, downloadFile } from './file-dialogs.js';

// Application lifecycle management
export { setupExitConfirmation } from './lifecycle.js';

// Shell operations (e.g., opening external URLs)
export { openUrl } from './shell.js';

