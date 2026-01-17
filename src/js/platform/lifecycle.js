/**
 * Application Lifecycle Management
 * 
 * Handles application exit confirmation and other lifecycle events.
 */

import { isTauri } from './environment.js';

/**
 * Sets up the application exit confirmation to prevent accidental closing.
 * 
 * - Web: Uses the standard `beforeunload` event.
 * - Tauri: Intercepts the window close request to ensure data is checkpointed.
 */
export function setupExitConfirmation() {
    if (!isTauri()) {
        // Web implementation: use standard beforeunload
        window.addEventListener("beforeunload", (event) => {
            event.preventDefault();
            // returnValue is required for some browsers
            event.returnValue = '';
        });
    } else {
        // Tauri: Use Tauri's window close request event to checkpoint before exit.
        // Critical: This is a best-effort operation. DuckDB's WAL should handle recovery if this fails.
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
            getCurrentWindow().onCloseRequested(async () => {
                const { forceCheckpoint } = await import('../core/checkpoint-manager.js');
                await forceCheckpoint();
                // Allow close to proceed (no event.preventDefault())
            });
        }).catch(() => {
            // Ignore if window API unavailable
        });
    }
}