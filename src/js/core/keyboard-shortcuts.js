/**
 * Global Keyboard Shortcuts
 * 
 * Handles application-wide keyboard shortcuts that work from any context,
 * including when focus is inside the Monaco editor.
 */

// Registered action handlers
let _actions = {
    loadFile: null,
    openTabSwitcher: null
};

// Track initialization state to prevent duplicate listeners
let _initialized = false;

/**
 * Initialize global keyboard shortcuts
 * @param {object} actions - Action handlers
 * @param {function} actions.loadFile - Handler for Ctrl+O (load file)
 * @param {function} actions.openTabSwitcher - Handler for Ctrl+K (tab switcher)
 */
export function initGlobalShortcuts(actions) {
    if (_initialized) {
        console.warn('Global keyboard shortcuts already initialized');
        return;
    }

    _actions = { ..._actions, ...actions };

    // Register global keydown handler with capture phase to intercept before Monaco
    document.addEventListener('keydown', handleGlobalKeydown, true);

    _initialized = true;
}

/**
 * Global keydown event handler
 * Uses capture phase to intercept shortcuts before they reach Monaco editor
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleGlobalKeydown(e) {
    // Only handle Ctrl/Cmd key combinations
    if (!e.ctrlKey && !e.metaKey) return;

    // Ignore if other modifier keys are pressed (except Shift for some combos)
    if (e.altKey) return;

    switch (e.key.toLowerCase()) {
        case 'o':
            // Ctrl+O: Load file (global)
            if (_actions.loadFile) {
                e.preventDefault();
                e.stopPropagation();
                _actions.loadFile();
            }
            break;

        case 'k':
            // Ctrl+K: Open tab switcher (global)
            if (_actions.openTabSwitcher) {
                e.preventDefault();
                e.stopPropagation();
                _actions.openTabSwitcher();
            }
            break;
    }
}
