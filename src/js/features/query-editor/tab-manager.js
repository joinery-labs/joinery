/**
 * Tab Manager
 * 
 * Manages the lifecycle and UI state of query tabs.
 * Handles creation, removal, renaming, and drag-and-drop reordering of tabs.
 * Optimized with event delegation, proper resource cleanup, and element caching.
 */

import { Tab } from 'bootstrap';

import { escapeHTML, $, $$, getCachedElement, clearCachedElement } from '../../utils/dom.js';

// ============================================================================
// State
// ============================================================================

let _tabList = null;
let _tabContent = null;
let _closeHandlerRegistered = false;

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Get cached tabList element
 * @returns {HTMLElement|null}
 */
function getTabList() {
    if (!_tabList || !_tabList.isConnected) {
        _tabList = getCachedElement('tabList');
    }
    return _tabList;
}

/**
 * Get cached tabContent element
 * @returns {HTMLElement|null}
 */
function getTabContent() {
    if (!_tabContent || !_tabContent.isConnected) {
        _tabContent = getCachedElement('tabContent');
    }
    return _tabContent;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Create a new query tab
 * @param {number} id - Tab ID
 * @param {string} defaultTitle - Default tab title
 * @returns {object} Tab elements (li, contentDiv, newTabId, newContentId)
 */
export function createQueryTab(id, defaultTitle) {
    const newTabId = `tab-${id}`;
    const newContentId = `query-${id}`;

    // Deactivate current tab
    $(".nav-link.active")?.classList.remove("active");
    $(".tab-pane.show.active")?.classList.remove("show", "active");

    // Create tab navigation item
    const li = document.createElement("li");
    li.className = "nav-item";
    li.id = `tab-li-${id}`;
    li.innerHTML = `
    <a class="nav-link active" id="${newTabId}" data-bs-toggle="tab" href="#${newContentId}" role="tab">
      <i class="bi bi-code-square" style="opacity: 0.7;"></i>
      <span class="tab-title" data-tab-title title="${escapeHTML(defaultTitle)}">${escapeHTML(defaultTitle)}</span>
      <i class="bi bi-x-lg tab-close" role="button" title="Close" data-tab-close="${id}"></i>
    </a>`;

    const tabList = getTabList();
    tabList.insertBefore(li, tabList.lastElementChild);
    makeTabDraggable(li);

    // Create tab content pane
    const div = document.createElement("div");
    div.className = "tab-pane fade show active";
    div.id = newContentId;
    div.setAttribute("role", "tabpanel");
    div.innerHTML = `
        <div class="mb-2 history-row">
        <div id="history-treeselect-${id}" class="history-treeselect"></div>
        <button id="manage-history-${id}" class="btn btn-base btn-manage" title="Manage saved queries">
            <i class="bi bi-bookmark-star"></i>
            <span class="btn-text">Manage</span>
        </button>
        </div>
        <div id="sql-editor-wrap-${id}"
            class="editor-wrapper-base form-control mb-2 p-0 loading-overlay-zone">
        <div id="sql-editor-${id}" style="height: 100%;"></div>
        <div id="editor-loading-${id}" class="loading-overlay">
            <div class="loading-overlay-spinner"></div>
            <span class="loading-overlay-text">Executing query...</span>
        </div>
        </div>
        <div class="mb-4 actions-row">
        <button id="run-query-${id}" class="btn btn-base btn-run" title="Run Query (Ctrl + Enter)">
            <i class="bi bi-play-circle"></i>
            <span>Run</span>
        </button>
        <button id="save-query-${id}" class="btn btn-base btn-save" title="Save query to history">
            <i class="bi bi-bookmark-plus"></i>
            <span class="btn-text">Save</span>
        </button>
        </div>
        <div id="query-output-${id}"></div>
    `;

    const tabContent = getTabContent();
    tabContent.appendChild(div);

    // Activate the tab
    new Tab(document.getElementById(newTabId)).show();

    // Setup tab renaming
    setupTabRenaming(li, newTabId);

    // Scroll to the new active tab
    scrollToActiveTab();

    return { li, contentDiv: div, newTabId, newContentId };
}

/**
 * Closes a query tab and ensures proper disposal of associated editors, DOM elements, and cached data.
 * @param {number} tabId - ID of the tab to remove.
 * @param {function} cleanupEditor - Callback to properly dispose of the Monaco editor instance.
 * @param {function} cleanupResults - Callback to cleanup result DOM elements and event listeners.
 */
export function removeQueryTab(tabId, cleanupEditor, cleanupResults) {
    const tab = document.getElementById(`tab-${tabId}`);
    const content = document.getElementById(`query-${tabId}`);
    const li = document.getElementById(`tab-li-${tabId}`);

    if (tab && content) {
        const isActive = tab.classList.contains("active");
        const prevTab = tab.parentElement.previousElementSibling?.querySelector("a.nav-link:not(#addTab)");

        // Cleanup result blocks
        if (cleanupResults) {
            for (const el of content.querySelectorAll(".result-block")) {
                cleanupResults(el);
            }
        }

        // Cleanup editor
        if (cleanupEditor) {
            cleanupEditor(tabId);
        }

        // Clear cached elements for this tab
        clearCachedElement(`tab-${tabId}`);
        clearCachedElement(`tab-li-${tabId}`);
        clearCachedElement(`query-${tabId}`);
        clearCachedElement(`run-query-${tabId}`);
        clearCachedElement(`save-query-${tabId}`);
        clearCachedElement(`editor-loading-${tabId}`);
        clearCachedElement(`history-treeselect-${tabId}`);

        // Remove DOM elements
        if (li) li.remove();
        content.remove();

        // Activate previous or Database tab
        if (isActive) {
            if (prevTab) {
                new Tab(prevTab).show();
            } else {
                const schemaTab = getCachedElement("schema");
                if (schemaTab) new Tab(schemaTab).show();
            }
            setTimeout(() => scrollToActiveTab(), 100);
        }
    }
}

// Store reference to tab close handler (set during initialization)
let _onTabClose = null;

/**
 * Sets up global event listeners for tab reordering (drag & drop) and delegated close actions.
 * @param {function} onTabClose - Global callback to handle tab closure requests (receives tabId).
 */
export function initTabDragDrop(onTabClose) {
    const tabList = getTabList();
    if (!tabList) return;

    // Store the callback for event delegation
    _onTabClose = onTabClose;

    // Drag and drop
    tabList.addEventListener("dragover", e => {
        e.preventDefault();
        const dragging = $("#tabList li.nav-item.dragging");
        if (!dragging) return;

        const after = getAfterElement(e.clientX);
        if (after == null) {
            tabList.insertBefore(dragging, tabList.lastElementChild);
        } else {
            tabList.insertBefore(dragging, after);
        }
    });

    // Event delegation for tab close buttons
    if (!_closeHandlerRegistered) {
        tabList.addEventListener("click", (e) => {
            const closeBtn = e.target.closest('[data-tab-close]');
            if (closeBtn) {
                e.preventDefault();
                e.stopPropagation();
                const tabId = parseInt(closeBtn.dataset.tabClose, 10);
                if (!isNaN(tabId) && _onTabClose) {
                    _onTabClose(tabId);
                }
            }
        });
        _closeHandlerRegistered = true;
    }
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Configures HTML5 drag-and-drop attributes and event handlers for a tab element.
 * @param {HTMLElement} li - The tab list item element.
 */
function makeTabDraggable(li) {
    const link = $("a.nav-link", li);
    if (!link || link.id === "schema" || li.classList.contains("add-tab")) return;

    li.setAttribute("draggable", "true");

    li.addEventListener("dragstart", e => {
        li.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", link.id);
    });

    li.addEventListener("dragend", () => {
        li.classList.remove("dragging");
    });
}

/**
 * Find the element after which to insert the dragged tab
 * @param {number} x - Mouse X position
 * @returns {HTMLElement|null} Element to insert before
 */
function getAfterElement(x) {
    const items = $$("#tabList li.nav-item:not(.add-tab):not(.dragging)");
    let closest = null;
    let closestOffset = Number.NEGATIVE_INFINITY;

    for (const it of items) {
        const box = it.getBoundingClientRect();
        const offset = x - (box.left + box.width / 2);
        if (offset < 0 && offset > closestOffset) {
            closestOffset = offset;
            closest = it;
        }
    }

    return closest;
}

/**
 * Attaches context menu listeners to enable right-click renaming of tab titles.
 * @param {HTMLElement} li - The tab list item.
 * @param {string} tabId - The DOM ID of the tab anchor.
 */
function setupTabRenaming(li, tabId) {
    const link = document.getElementById(tabId);
    const titleSpan = $('[data-tab-title]', link);

    titleSpan.addEventListener("contextmenu", e => showTabContextMenu(e, titleSpan));
}

/**
 * Show context menu for tab
 * @param {Event} e - Context menu event
 * @param {HTMLElement} titleSpan - Title span element
 */
function showTabContextMenu(e, titleSpan) {
    e.preventDefault();

    // Remove existing context menu if any
    const existing = document.getElementById("tab-context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.id = "tab-context-menu";
    menu.className = "dropdown-menu show";
    menu.style.position = "absolute";
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;
    menu.style.zIndex = "10000";

    const renameItem = document.createElement("a");
    renameItem.className = "dropdown-item";
    renameItem.href = "#";
    renameItem.innerHTML = '<i class="bi bi-pencil"></i> Rename';
    renameItem.onclick = (evt) => {
        evt.preventDefault();
        menu.remove();
        startRename(titleSpan);
    };

    menu.appendChild(renameItem);
    document.body.appendChild(menu);

    // Close menu on click elsewhere - use once option
    const closeMenu = (evt) => {
        if (!menu.contains(evt.target)) {
            menu.remove();
        }
    };

    // Use setTimeout to avoid immediate trigger
    setTimeout(() => {
        document.addEventListener("click", closeMenu, { once: true });
    }, 0);
}

/**
 * Start inline tab rename
 * @param {HTMLElement} spanOrEvent - Span element or event with currentTarget
 */
function startRename(spanOrEvent) {
    const span = spanOrEvent.currentTarget || spanOrEvent;
    const cur = span.textContent.trim();

    const input = document.createElement("input");
    input.type = "text";
    input.value = cur;
    input.className = "form-control tab-title-input";

    span.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = (commit) => {
        if (finished) return;
        finished = true;

        const val = commit ? (input.value.trim() || cur) : cur;
        const newSpan = document.createElement("span");
        newSpan.className = "tab-title";
        newSpan.setAttribute("data-tab-title", "");
        newSpan.setAttribute("title", val);
        newSpan.textContent = val;

        input.replaceWith(newSpan);

        // Re-attach rename listeners
        newSpan.addEventListener("contextmenu", e => showTabContextMenu(e, newSpan));
    };

    input.addEventListener("keydown", e => {
        // Allow arrow keys in input without affecting Bootstrap tabs
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
            e.stopPropagation();
            return;
        }

        if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
        }
    });

    input.addEventListener("blur", () => finish(true));
}

/**
 * Scroll the active tab into view
 */
function scrollToActiveTab() {
    const activeTab = $("#tabList .nav-link.active");
    if (activeTab) {
        // Small delay to ensure tab is fully rendered
        setTimeout(() => {
            activeTab.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center'
            });
        }, 50);
    }
}