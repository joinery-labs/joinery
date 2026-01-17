/**
 * Fullscreen Mode Management
 * Handles expanding and collapsing result blocks.
 */

import { $ } from '../../utils/dom.js';

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Get count of result blocks in fullscreen mode.
 * @returns {number} Active fullscreen block count
 */
function expandedBlockCount() {
    return document.querySelectorAll(".result-block.in-fullscreen").length;
}

/**
 * Collapse a result block from fullscreen
 * @param {HTMLElement} block - Result block element
 */
function collapseBlock(block) {
    block.classList.remove("in-fullscreen");

    const btn = block.querySelector(".btn-expand");
    if (btn) {
        btn.title = "Expand";
        btn.innerHTML = `<i class="bi bi-arrows-angle-expand"></i>`;
        btn.setAttribute("aria-pressed", "false");
        btn.setAttribute("aria-expanded", "false");
    }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Setup fullscreen mode handlers for a result block
 * @param {HTMLElement} root - Result block root element
 * @param {HTMLElement} tableWrap - Table wrapper element
 * @param {HTMLElement} expandBtn - Expand button element
 * @param {AbortSignal} signal - Abort signal for cleanup
 * @returns {object} Fullscreen control functions: {setExpanded, cleanup}
 */
export function setupFullscreenMode(root, tableWrap, expandBtn, signal) {
    expandBtn.setAttribute("aria-expanded", "false");
    expandBtn.setAttribute("aria-controls", tableWrap.id);

    /**
     * Set fullscreen state for this result block
     * @param {boolean} active - True to expand, false to collapse
     */
    function setExpanded(active) {
        if (active) {
            // capture body overflow only once globally
            if (!("prevOverflow" in document.body.dataset)) {
                document.body.dataset.prevOverflow = document.body.style.overflow || "";
            }

            // collapse others without destroying their state
            document.querySelectorAll(".result-block.in-fullscreen").forEach(rb => {
                if (rb !== root) collapseBlock(rb);
            });

            root.classList.add("in-fullscreen");

            expandBtn.title = "Collapse";
            expandBtn.innerHTML = `<i class="bi bi-arrows-angle-contract"></i>`;
            expandBtn.setAttribute("aria-pressed", "true");
            expandBtn.setAttribute("aria-expanded", "true");

            document.body.style.overflow = "hidden";
        } else {
            collapseBlock(root);

            if (expandedBlockCount() === 0) {
                const prev = document.body.dataset.prevOverflow || "";
                document.body.style.overflow = prev;
                delete document.body.dataset.prevOverflow;
            }
        }
    }

    // Expand button click handler
    expandBtn.addEventListener("click", () => {
        setExpanded(!root.classList.contains("in-fullscreen"));
    });

    // ESC key handler
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && root.classList.contains("in-fullscreen")) {
            setExpanded(false);
        }
    }, { signal });

    return {
        setExpanded,
        cleanup: () => setExpanded(false)
    };
}
