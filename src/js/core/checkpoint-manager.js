/**
 * Checkpoint Manager
 *
 * Manages database checkpoints to balance data safety with performance.
 * Throttles FORCE CHECKPOINT calls after database modifications to prevent excessive I/O.
 */

import { on, Events } from './event-bus.js';
import { getActiveDbState } from './database.js';

// Configuration
const CONFIG = {
    throttleMs: 5000,
    maxChangesBeforeForce: 50,
    checkpointOnUnload: true
};

// State
let _lastCheckpointTime = 0;
let _changesSinceCheckpoint = 0;
let _checkpointInProgress = false;
let _initialized = false;

/**
 * Initialize checkpoint manager.
 * Sets up beforeunload handler and event subscriptions.
 */
export function initCheckpointManager() {
    // Prevent duplicate initialization
    if (_initialized) return;
    _initialized = true;

    if (CONFIG.checkpointOnUnload && typeof window !== 'undefined') {
        window.addEventListener('beforeunload', handleBeforeUnload);
    }

    // Subscribe to schema change events to trigger checkpoints
    on(Events.SCHEMA_CHANGED, () => {
        notifyChange();
    });
}

/**
 * Handle beforeunload - attempt final checkpoint.
 */
function handleBeforeUnload() {
    const state = getActiveDbState();
    if (state?.conn && _changesSinceCheckpoint > 0) {
        // Best-effort checkpoint; may not complete if page unloads immediately
        state.conn.query('CHECKPOINT;').catch(() => { /* ignore */ });
    }
}

/**
 * Notify the manager that a database change occurred.
 * Triggers a checkpoint if conditions are met.
 */
export async function notifyChange() {
    const state = getActiveDbState();
    if (!state?.conn) return;

    _changesSinceCheckpoint++;

    const now = Date.now();
    const timeSinceLastCheckpoint = now - _lastCheckpointTime;

    const shouldCheckpoint =
        (timeSinceLastCheckpoint >= CONFIG.throttleMs && _changesSinceCheckpoint > 0) ||
        _changesSinceCheckpoint >= CONFIG.maxChangesBeforeForce;

    if (shouldCheckpoint && !_checkpointInProgress) {
        await runCheckpoint(state.conn);
    }
}

/**
 * Force an immediate checkpoint on the active database.
 * @returns {Promise<boolean>} True if checkpoint succeeded
 */
export async function forceCheckpoint() {
    const state = getActiveDbState();
    if (!state?.conn || _checkpointInProgress) return false;
    return await runCheckpoint(state.conn);
}

/**
 * Run a checkpoint operation with retry logic.
 * @param {AsyncDuckDBConnection} conn - DuckDB connection
 * @param {number} maxRetries - Maximum retry attempts for transient failures
 * @returns {Promise<boolean>} True if checkpoint succeeded
 */
async function runCheckpoint(conn, maxRetries = 2) {
    if (_checkpointInProgress) return false;

    try {
        _checkpointInProgress = true;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await conn.query('FORCE CHECKPOINT;');
                _lastCheckpointTime = Date.now();
                _changesSinceCheckpoint = 0;
                return true;
            } catch (error) {
                const isTransient = error?.message?.includes('busy') ||
                    error?.message?.includes('locked') ||
                    error?.message?.includes('timeout');

                if (!isTransient || attempt === maxRetries) {
                    console.error('[Checkpoint] Error:', error);
                    return false;
                }

                // Exponential backoff
                await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
            }
        }
        return false;
    } finally {
        _checkpointInProgress = false;
    }
}

/**
 * Reset checkpoint state.
 */
export function resetCheckpointState() {
    _lastCheckpointTime = 0;
    _changesSinceCheckpoint = 0;
    _checkpointInProgress = false;
}
