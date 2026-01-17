/**
 * Pagination Controls
 * Manages pagination UI and state.
 */

import { $ } from '../../utils/dom.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Create pagination controls HTML
 * @returns {HTMLElement} Pagination controls element
 */
export function createPaginationControls() {
    const pager = document.createElement("div");
    pager.className = "pagination-controls d-flex align-items-center justify-content-between gap-2 flex-wrap";
    pager.innerHTML = `
        <div class="d-flex align-items-center gap-2">
        <button class="btn btn-base btn-sm btn-prev" title="Previous page">
            <i class="bi bi-chevron-left"></i>
        </button>
        <div class="d-flex align-items-center gap-2">
            <span class="label-muted">Page</span>
            <input type="number" class="form-control form-control-base page-input" style="width: 100px;" min="1" value="1">
            <span class="label-muted page-total">of 1</span>
        </div>
        <button class="btn btn-base btn-sm btn-next" title="Next page">
            <i class="bi bi-chevron-right"></i>
        </button>
        </div>
        <div class="label-muted showing-info" style="font-size: 0.8125rem;">Showing 0-0 of 0</div>
    `;
    return pager;
}

/**
 * Update pagination state (buttons, input, info text)
 * @param {HTMLElement} pager - Pagination element
 * @param {number} page - Current page number
 * @param {number} totalPages - Total number of pages
 * @param {number} totalRows - Total number of rows
 * @param {number} pageSize - Number of rows per page
 */
export function updatePaginationState(pager, page, totalPages, totalRows, pageSize) {
    if (!pager) return;

    const prev = $(".btn-prev", pager);
    const next = $(".btn-next", pager);
    const pageInput = $(".page-input", pager);
    const pageTotal = $(".page-total", pager);
    const showingInfo = $(".showing-info", pager);

    if (prev) prev.disabled = (page <= 1);
    if (next) next.disabled = (page >= totalPages);

    if (pageInput) {
        pageInput.value = page;
        pageInput.max = totalPages;
        pageInput.disabled = (totalPages <= 1);
    }

    if (pageTotal) {
        pageTotal.textContent = `of ${totalPages}`;
    }

    if (showingInfo) {
        const start = (page - 1) * pageSize;
        const end = Math.min(totalRows, start + pageSize);
        const showingStart = totalRows === 0 ? 0 : start + 1;
        const showingEnd = end;
        showingInfo.textContent = `Showing ${showingStart}-${showingEnd} of ${totalRows}`;
    }
}

/**
 * Setup pagination event handlers
 * @param {HTMLElement} pager - Pagination element
 * @param {function} onPageChange - Callback when page changes: (newPage) => void
 * @param {function} getTotalPages - Callback to get current total pages: () => number
 */
export function setupPaginationHandlers(pager, onPageChange, getTotalPages) {
    if (!pager) return;

    const prev = $(".btn-prev", pager);
    const next = $(".btn-next", pager);
    const pageInput = $(".page-input", pager);

    if (prev) {
        prev.addEventListener("click", () => {
            onPageChange("prev");
        });
    }

    if (next) {
        next.addEventListener("click", () => {
            onPageChange("next");
        });
    }

    if (pageInput) {
        function goToPageFromInput() {
            const totalPages = getTotalPages();
            let newPage = parseInt(pageInput.value, 10);

            if (isNaN(newPage) || newPage < 1) {
                newPage = 1;
            } else if (newPage > totalPages) {
                newPage = totalPages;
            }

            onPageChange(newPage);
        }

        pageInput.addEventListener("change", () => {
            goToPageFromInput();
        });

        pageInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                goToPageFromInput();
                pageInput.blur();
            }
        });
    }
}
