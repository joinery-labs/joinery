/**
 * Monaco Editor Loader
 * Initializes Monaco with ESM support and SQL formatting configuration.
 */

import * as monaco from 'monaco-editor';
import { format } from 'sql-formatter';

// Configure worker loading for Vite using the generic editor worker.
self.MonacoEnvironment = {
    getWorker: () => new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        { type: 'module' }
    )
};

// Disable global word-based suggestions to prioritize SQL-specific completions.
(function initSuggestBehavior() {
    // Override editor.create to enforce suggestion settings.
    const origCreate = monaco.editor.create;
    monaco.editor.create = function (domEl, opts = {}, ...rest) {
        const mergedOpts = {
            wordBasedSuggestions: 'off',
            ...opts,
            suggest: { showWords: false, ...(opts.suggest || {}) }
        };
        return origCreate.call(this, domEl, mergedOpts, ...rest);
    };
})();

// Register SQL formatting providers.
(function initSqlFormatter() {
    // Provider for full document formatting.
    monaco.languages.registerDocumentFormattingEditProvider('sql', {
        provideDocumentFormattingEdits(model) {
            const formatted = format(model.getValue(), { language: 'postgresql', keywordCase: 'upper' });
            return [{ range: model.getFullModelRange(), text: formatted }];
        }
    });

    // Provider for range-based formatting.
    monaco.languages.registerDocumentRangeFormattingEditProvider('sql', {
        provideDocumentRangeFormattingEdits(model, range) {
            const text = model.getValueInRange(range);
            if (!text.trim()) return [];
            const formatted = format(text, { language: 'postgresql', keywordCase: 'upper' });
            return [{ range, text: formatted }];
        }
    });
})();

/**
 * asynchronously retrieves the Monaco namespace.
 * @returns {Promise<typeof monaco>}
 */
export async function getMonaco() {
    return monaco;
}

// Export monaco instance synchronously.
export { monaco };
