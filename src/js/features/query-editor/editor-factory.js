/**
 * Monaco Editor Factory
 * Creates, configures, and manages Monaco editor instances.
 */

import { format as sqlFormat } from 'sql-formatter';
import { getMonaco } from '../../editor/monaco-loader.js';
import { enableSqlSuggestions } from '../../editor/sql-intellisense.js';
import { getCachedElement } from '../../utils/dom.js';

// Active editor instances
const EDITORS = new Map();

/**
 * Get editor instance by ID
 * @param {string|number} editorId - Editor identifier
 * @returns {object|null} Monaco editor instance or null
 */
export function getEditor(editorId) {
  return EDITORS.get(editorId) || null;
}

/**
 * Check if an editor exists
 * @param {string|number} editorId - Editor identifier
 * @returns {boolean}
 */
export function hasEditor(editorId) {
  return EDITORS.has(editorId);
}

/**
 * Extract SQL from editor (selection or full content)
 * @param {object} editor - Monaco editor instance
 * @returns {{ sql: string }}
 */
export function getSqlFromEditor(editor) {
  const model = editor.getModel();
  const selection = editor.getSelection();
  const selected = model.getValueInRange(selection);
  return { sql: selected.trim() ? selected : model.getValue() };
}

/**
 * Default editor options
 */
const DEFAULT_OPTIONS = {
  lineNumbers: 'on',
  padding: { top: 10, bottom: 10 },
  runButtonId: null,   // ID of the DOM element to trigger when executing the run command (Ctrl+Enter)
  onRun: null,         // Custom callback to execute when the run command is triggered (overrides runButtonId)
  onSave: null         // Custom callback to execute when save shortcut is triggered (Ctrl+S)
};

/**
 * Create Monaco editor or fallback to textarea
 * @param {string} wrapId - Wrapper element ID
 * @param {string} hostId - Host element ID for Monaco
 * @param {string|number} editorId - Unique editor identifier
 * @param {string} prefillText - Initial SQL text
 * @param {object} options - Optional configuration
 * @param {function} onReady - Callback when editor is ready: (editor, isFallback) => void
 */
export async function createEditor(wrapId, hostId, editorId, prefillText, options = {}, onReady = null) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const monaco = await getMonaco();
    const wrapEl = document.getElementById(wrapId);
    const hostEl = document.getElementById(hostId);

    if (!wrapEl || !hostEl) {
      console.warn(`Editor elements not found: ${wrapId}, ${hostId}`);
      createTextareaFallback(wrapId, editorId, prefillText, opts, onReady);
      return;
    }

    const editor = monaco.editor.create(hostEl, {
      value: prefillText || '',
      language: 'sql',
      automaticLayout: true,
      theme: document.body.getAttribute('data-bs-theme') === 'dark' ? 'vs-dark' : 'vs',
      glyphMargin: false,
      folding: false,
      lineNumbers: opts.lineNumbers,
      lineNumbersMinChars: 3,
      lineDecorationsWidth: opts.lineNumbers === 'on' ? 20 : 5,
      padding: opts.padding,
      wordWrap: 'on',
      renderLineHighlight: 'line',
      renderLineHighlightOnlyWhenFocus: true,
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true },
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      scrollbar: { useShadows: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8, alwaysConsumeMouseWheel: false },
      mouseWheelZoom: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      fontLigatures: true,
      fontFamily: "Consolas, 'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 14,
      contextmenu: true,
      acceptSuggestionOnEnter: 'on',
      acceptSuggestionOnCommitCharacter: false,
      tabCompletion: 'off',
      wordBasedSuggestions: 'off',
      quickSuggestions: true,
      suggest: { showWords: false, insertMode: 'replace', filterGraceful: true }
    });

    EDITORS.set(editorId, editor);

    // Layout observer for resize handling
    const resizeObserver = new ResizeObserver(() => editor.layout());
    resizeObserver.observe(wrapEl);
    editor._resizeObserver = resizeObserver;

    // Keyboard shortcuts
    addEditorActions(editor, monaco, editorId, opts);

    // SQL IntelliSense
    enableSqlSuggestions();

    if (onReady) onReady(editor, false);
  } catch (err) {
    console.warn('Monaco creation failed:', err);
    createTextareaFallback(wrapId, editorId, prefillText, opts, onReady);
  }
}

/**
 * Destroy editor and cleanup
 * @param {string|number} editorId - Editor identifier
 * @returns {boolean} True if editor was found and destroyed
 */
export function destroyEditor(editorId) {
  const editor = EDITORS.get(editorId);
  if (!editor) return false;

  try {
    editor._resizeObserver?.disconnect();
    editor.dispose();
  } catch (e) {
    console.warn(`Editor cleanup error for ${editorId}:`, e);
  }

  EDITORS.delete(editorId);
  return true;
}

/**
 * Add keyboard shortcuts to editor
 * @param {object} editor - Monaco editor instance
 * @param {object} monaco - Monaco module
 * @param {string|number} editorId - Editor identifier
 * @param {object} opts - Editor options
 */
function addEditorActions(editor, monaco, editorId, opts) {
  // Run SQL action
  editor.addAction({
    id: 'run-sql',
    label: 'Run SQL',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
    contextMenuGroupId: '1_modification',
    run: () => {
      if (opts.onRun) {
        opts.onRun();
      } else if (opts.runButtonId) {
        getCachedElement(opts.runButtonId)?.click();
      }
    }
  });

  editor.addAction({
    id: 'toggle-comment',
    label: 'Toggle Comment',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
    run: () => editor.trigger('any', 'editor.action.commentLine')
  });

  editor.addAction({
    id: 'trigger-suggest',
    label: 'Trigger Suggest',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
    run: () => editor.trigger('kb', 'editor.action.triggerSuggest', {})
  });

  // Format SQL action
  editor.addAction({
    id: 'format-sql',
    label: 'Format SQL',
    keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
    run: () => {
      const model = editor.getModel();
      const selection = editor.getSelection();
      const selectedText = model.getValueInRange(selection);
      const fullText = model.getValue();
      const target = selectedText.trim() ? selectedText : fullText;

      try {
        const formatted = sqlFormat(target, { language: 'postgresql', keywordCase: 'upper' });
        if (selectedText.trim()) {
          editor.executeEdits('format', [{
            range: selection,
            text: formatted
          }]);
        } else {
          editor.setValue(formatted);
        }
      } catch (e) {
        console.error('Format error:', e);
      }
    }
  });

  // Save Query action (Ctrl+S)
  if (opts.onSave) {
    editor.addAction({
      id: 'save-query',
      label: 'Save Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      contextMenuGroupId: '1_modification',
      run: () => opts.onSave()
    });
  }
}

/**
 * Create textarea fallback when Monaco fails
 * @param {string} wrapId - Wrapper element ID
 * @param {string|number} editorId - Editor identifier
 * @param {string} prefillText - Initial SQL text
 * @param {object} opts - Editor options
 * @param {function} onReady - Ready callback
 */
function createTextareaFallback(wrapId, editorId, prefillText, opts, onReady) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) {
    if (onReady) onReady(null, true);
    return;
  }

  const textareaId = `sql-query-${editorId}`;
  wrap.innerHTML = `<textarea id="${textareaId}" class="form-control fontcode mb-0 border-0"
        style="width:100%;height:100%;resize:none;outline:none" placeholder="Enter your query here..."></textarea>`;

  const ta = document.getElementById(textareaId);
  ta.value = prefillText || '';

  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (opts.onRun) {
        opts.onRun();
      } else if (opts.runButtonId) {
        getCachedElement(opts.runButtonId)?.click();
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (opts.onSave) {
        opts.onSave();
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      toggleComment(ta);
    }
    if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      formatSQL(ta);
    }
  });

  if (onReady) onReady(null, true);
}

/**
 * Toggle SQL comments in textarea
 * @param {HTMLTextAreaElement} textarea
 */
function toggleComment(textarea) {
  const { selectionStart, selectionEnd, value } = textarea;
  const before = value.slice(0, selectionStart);
  const selected = value.slice(selectionStart, selectionEnd);
  const after = value.slice(selectionEnd);

  const lines = selected.split(/\r?\n/);
  const allCommented = lines.every(l => l.trim().startsWith('--'));
  const toggled = lines.map(l =>
    allCommented ? l.replace(/^\s*--\s?/, '') : (l.length ? `-- ${l}` : l)
  ).join('\n');

  textarea.value = before + toggled + after;
  textarea.selectionStart = selectionStart;
  textarea.selectionEnd = selectionStart + toggled.length;
}

/**
 * Format SQL in textarea
 * @param {HTMLTextAreaElement} textarea
 */
function formatSQL(textarea) {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const target = selected.trim() ? selected : value;

  try {
    const formatted = sqlFormat(target, { language: 'postgresql', keywordCase: 'upper' });
    if (selected.trim()) {
      textarea.value = value.slice(0, selectionStart) + formatted + value.slice(selectionEnd);
    } else {
      textarea.value = formatted;
    }
  } catch (e) {
    console.error('Format error:', e);
  }
}
