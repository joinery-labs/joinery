/**
 * Export/Import Entry Point
 * Orchestrates module initialization and wires up event handlers.
 */

import { setupEventHandlers } from './event-handlers.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Initialize export/import system
 */
export function initExportImport() {
    setupEventHandlers();
}
