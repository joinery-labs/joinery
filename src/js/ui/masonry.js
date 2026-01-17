/**
 * Masonry Layout Module
 * Masonry layout implementation using absolute positioning.
 * Places each card in the shortest column for optimal space utilization.
 * 
 * Automatically re-layouts when:
 * - Container width changes (responsive)
 * - Any masonry item's height changes (content expansion/collapse)
 */

import { getCachedElement } from '../utils/dom.js';

// Configuration

/** Debounce delay for resize events (ms) */
const RESIZE_DEBOUNCE_MS = 100;

// Private State

let _container = null;
let _containerObserver = null;
let _itemObserver = null;
let _observedItems = new WeakSet();
let _rafId = null;
let _debounceTimer = null;

// Core Layout Logic

/**
 * Get computed CSS token value as a number
 * @param {string} property - CSS custom property name
 * @param {number} defaultValue - Fallback if token is undefined or zero
 * @returns {number} Parsed pixel value
 */
function getCSSToken(property, defaultValue = 0) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(property);
    return parseFloat(value) || defaultValue;
}

/**
 * Calculate and apply masonry positions to all visible items.
 * Also ensures all items are observed for size changes.
 */
function layoutItems() {
    if (!_container) return;

    const items = Array.from(_container.querySelectorAll('.masonry-item'));
    const visibleItems = items.filter(item => item.style.display !== 'none');

    // Observe any new items for size changes
    if (_itemObserver) {
        for (const item of items) {
            if (!_observedItems.has(item)) {
                _itemObserver.observe(item);
                _observedItems.add(item);
            }
        }
    }

    if (visibleItems.length === 0) {
        _container.style.height = '0px';
        return;
    }

    // Read CSS tokens (with sensible defaults)
    const columnWidth = getCSSToken('--masonry-column-width', 280);
    const gap = getCSSToken('--masonry-gap', 16);

    // Calculate column count based on container width
    const containerWidth = _container.clientWidth;

    // Skip layout if container is hidden or has no width
    if (containerWidth <= 0) return;

    const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (columnWidth + gap)));

    // Calculate actual column width to fill container
    const actualColumnWidth = (containerWidth - (columnCount - 1) * gap) / columnCount;

    // Track height of each column
    const columnHeights = new Array(columnCount).fill(0);

    // Batch-read all heights first (avoids forced reflow in positioning loop)
    const itemHeights = visibleItems.map(item => item.offsetHeight);

    // Position each item
    for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];

        // Find shortest column
        const shortestColumn = columnHeights.indexOf(Math.min(...columnHeights));

        // Calculate position
        const x = shortestColumn * (actualColumnWidth + gap);
        const y = columnHeights[shortestColumn];

        // Apply position and size
        item.style.position = 'absolute';
        item.style.left = `${x}px`;
        item.style.top = `${y}px`;
        item.style.width = `${actualColumnWidth}px`;

        // Update column height using pre-read height
        columnHeights[shortestColumn] = y + itemHeights[i] + gap;
    }

    // Set container height to tallest column
    _container.style.height = `${Math.max(...columnHeights) - gap}px`;
}

/**
 * Schedule layout on next animation frame (prevents layout thrashing)
 */
function scheduleLayout() {
    if (_rafId) {
        cancelAnimationFrame(_rafId);
    }
    _rafId = requestAnimationFrame(() => {
        layoutItems();
        _rafId = null;
    });
}

/**
 * Debounced resize handler
 */
function handleResize() {
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
    }
    _debounceTimer = setTimeout(scheduleLayout, RESIZE_DEBOUNCE_MS);
}

// Public API

/**
 * Initialize masonry layout on the #dbMasonry container
 */
export function initMasonry() {
    _container = getCachedElement('dbMasonry');
    if (!_container) {
        console.warn('Masonry container #dbMasonry not found');
        return;
    }

    // Container observer: triggers on container width changes (responsive)
    _containerObserver = new ResizeObserver(handleResize);
    _containerObserver.observe(_container);

    // Item observer: triggers when any masonry item's size changes
    // Uses same debounced handler to avoid layout thrashing
    _itemObserver = new ResizeObserver(handleResize);

    // Initial layout (will also observe existing items)
    scheduleLayout();
}

/**
 * Trigger a masonry relayout (call when cards show/hide)
 */
export function refreshMasonry() {
    scheduleLayout();
}

/**
 * Cleanup masonry (call on destroy)
 */
export function destroyMasonry() {
    if (_containerObserver) {
        _containerObserver.disconnect();
        _containerObserver = null;
    }
    if (_itemObserver) {
        _itemObserver.disconnect();
        _itemObserver = null;
    }
    _observedItems = new WeakSet();
    if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
    _container = null;
}

