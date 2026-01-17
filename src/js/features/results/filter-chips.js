/**
 * Filter Chips Rendering
 * Displays active filter and sort badges.
 */

import { escapeHTML, $ } from '../../utils/dom.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Render filter and sort chips/badges
 * @param {HTMLElement} container - Container element for chips
 * @param {Array<string>} columns - Column names
 * @param {number} sortCol - Current sort column index (-1 if none)
 * @param {boolean} sortAsc - Sort direction
 * @param {Array} filterState - Filter state array
 * @param {function} onClearSort - Callback when sort is cleared
 * @param {function} onClearFilter - Callback when filter is cleared: (colIdx) => void
 */
export function renderFilterChips(container, columns, sortCol, sortAsc, filterState, onClearSort, onClearFilter) {
    container.innerHTML = "";
    const fragment = document.createDocumentFragment();

    // Render sort chip
    if (sortCol >= 0) {
        const b = document.createElement("span");
        b.className = "filter-chip";
        b.innerHTML = `
            <i class="bi bi-sort-${sortAsc ? 'alpha-down' : 'alpha-up'}"></i>
            <span>${escapeHTML(columns[sortCol])}</span>
            <i class="bi bi-x-lg remove" role="button" aria-label="Clear sort"></i>
        `;
        $(".remove", b).onclick = onClearSort;
        fragment.appendChild(b);
    }

    // Render filter chips
    filterState.forEach((f, idx) => {
        if (!f) return;
        const b = document.createElement("span");
        b.className = "filter-chip";
        let txt = "";
        if (f.type === "number") {
            txt = `${columns[idx]}: ${f.min != null ? ">=" + f.min : ""} ${f.min != null && f.max != null ? "&" : " "} ${f.max != null ? "<=" + f.max : ""}`.trim();
        }
        else if (f.type === "date" || f.type === "datetime") {
            txt = `${columns[idx]}: ${f.from ? ("≥ " + f.from) : ""} ${f.from && f.to ? "&" : " "} ${f.to ? ("≤ " + f.to) : ""}`.trim();
        }
        else {
            txt = `${columns[idx]}: ${f.op} "${f.value}"${f.case ? " (cs)" : ""}`;
        }
        b.innerHTML = `
            <i class="bi bi-funnel-fill"></i>
            <span>${escapeHTML(txt)}</span>
            <i class="bi bi-x-lg remove" role="button" aria-label="Clear filter"></i>
        `;
        $(".remove", b).onclick = () => onClearFilter(idx);
        fragment.appendChild(b);
    });

    container.appendChild(fragment);
}
