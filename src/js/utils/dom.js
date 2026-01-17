/**
 * DOM utility functions
 */

import { downloadFile } from '../platform/index.js';

// Element Selectors

export const $ = (sel, parent = document) => parent.querySelector(sel);
export const $$ = (sel, parent = document) => Array.from(parent.querySelectorAll(sel));

// Element Cache

const _elementCache = new Map();

/**
 * Get cached DOM element by ID
 * @param {string} id - Element ID (without #)
 * @returns {HTMLElement|null}
 */
export function getCachedElement(id) {
    if (_elementCache.has(id)) {
        const el = _elementCache.get(id);
        // Verify element is still in DOM
        if (el && el.isConnected) {
            return el;
        }
        _elementCache.delete(id);
    }
    const el = document.getElementById(id);
    if (el) {
        _elementCache.set(id, el);
    }
    return el;
}

/**
 * Clear element from cache
 * @param {string} id - Element ID
 */
export function clearCachedElement(id) {
    _elementCache.delete(id);
}

// HTML Escaping

const _escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
};

const _escapeRegex = /[&<>"']/g;

/**
 * Escape HTML characters for safe rendering
 * @param {*} v - Value to escape
 * @returns {string} Escaped HTML string
 */
export function escapeHTML(v) {
    if (v == null) return '';
    return String(v).replace(_escapeRegex, char => _escapeMap[char]);
}

// Download Helper

/**
 * Download helper - triggers browser download of blob/buffer
 * Uses platform abstraction to support both web and Tauri
 * @param {Blob|ArrayBuffer|Uint8Array} data - Data to download
 * @param {string} mime - MIME type
 * @param {string} filename - Suggested filename
 */
export async function downloadBlob(data, mime, filename) {
    await downloadFile(data, mime, filename);
}
