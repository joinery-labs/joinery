/**
 * Theme Management Module
 * Handles light/dark theme toggle with persistence via platform config store.
 */

import { getConfig, setConfig } from '../platform/index.js';
import { monaco } from '../editor/monaco-loader.js';

const THEME_KEY = 'theme';

// Track initialization state
let initialized = false;

function applyTheme(theme) {
    const body = document.body;
    const btn = document.getElementById('themeToggleBtn');
    if (!body) return;

    const next = theme === 'dark' ? 'dark' : 'light';
    body.setAttribute('data-bs-theme', next);

    // Update Monaco editor theme
    const monacoTheme = next === 'dark' ? 'vs-dark' : 'vs';
    monaco.editor.setTheme(monacoTheme);

    // Update theme toggle button
    if (btn) {
        const icon = btn.querySelector('i');
        if (icon) {
            if (next === 'dark') {
                icon.classList.remove('bi-moon');
                icon.classList.add('bi-sun');
                btn.title = 'Switch to light theme';
                btn.setAttribute('aria-label', 'Switch to light theme');
            } else {
                icon.classList.remove('bi-sun');
                icon.classList.add('bi-moon');
                btn.title = 'Switch to dark theme';
                btn.setAttribute('aria-label', 'Switch to dark theme');
            }
        }
    }
}

export async function initTheme() {
    if (initialized) return;
    initialized = true;

    // Get saved theme from platform config store
    let saved = null;
    try {
        saved = await getConfig(THEME_KEY);
    } catch {
        /* ignore */
    }

    let initial = saved;
    if (!initial) {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        initial = prefersDark ? 'dark' : 'light';
    }

    applyTheme(initial);

    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.addEventListener('click', async () => {
            const current = document.body.getAttribute('data-bs-theme') || 'light';
            const next = current === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            try {
                await setConfig(THEME_KEY, next);
            } catch {
                /* ignore */
            }
        });
    } else {
        console.warn('Theme toggle button not found, theme switching disabled');
    }
}
