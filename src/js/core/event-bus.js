/**
 * Event Bus
 *
 * Centralized pub-sub event system for application-wide events.
 */

// ============================================================================
// Private State
// ============================================================================

/** @type {Map<string, Set<Function>>} */
const listeners = new Map();

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Emit an event to all subscribers.
 * @param {string} event - Event name
 * @param {*} [data] - Optional event data
 */
export function emit(event, data = null) {
    const handlers = listeners.get(event);
    if (!handlers || handlers.size === 0) return;

    // Execute handlers asynchronously
    for (const handler of handlers) {
        queueMicrotask(() => {
            try {
                handler(data);
            } catch (err) {
                console.error(`[EventBus] Error in handler for "${event}":`, err);
            }
        });
    }
}

/**
 * Subscribe to an event.
 * @param {string} event - Event name
 * @param {Function} callback - Handler function
 * @returns {Function} Unsubscribe function
 */
export function on(event, callback) {
    if (typeof callback !== 'function') {
        throw new TypeError('Event handler must be a function');
    }

    if (!listeners.has(event)) {
        listeners.set(event, new Set());
    }

    listeners.get(event).add(callback);

    return () => off(event, callback);
}

function off(event, callback) {
    const handlers = listeners.get(event);
    if (handlers) {
        handlers.delete(callback);
        if (handlers.size === 0) {
            listeners.delete(event);
        }
    }
}

// ============================================================================
// EVENT CONSTANTS
// ============================================================================

export const Events = {
    /** Schema changed: tables created/dropped/modified */
    SCHEMA_CHANGED: 'schema:changed',
    /** Saved queries modified: added, updated, or deleted */
    QUERIES_CHANGED: 'queries:changed',
    /** Active database switched */
    DATABASE_SWITCHED: 'database:switched'
};
