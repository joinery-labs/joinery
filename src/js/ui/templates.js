/**
 * UI Templates Module
 * Generates all application-wide UI components dynamically
 * Optimized with lazy modal loading and cached container references
 */

import { Modal } from 'bootstrap';
import { getCachedElement } from '../utils/dom.js';
import { openUrl } from '../platform/index.js';

// Cached State

let _containerFluid = null;

/**
 * Get cached container-fluid element
 * @returns {HTMLElement|null}
 */
function getContainerFluid() {
    if (!_containerFluid || !_containerFluid.isConnected) {
        _containerFluid = document.querySelector('.container-fluid');
    }
    return _containerFluid;
}

// UI Component Generators (Public API)

/**
 * Create and inject the application toolbar
 */
export function createAppToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'app-toolbar';
    toolbar.innerHTML = `
        <div class="toolbar-container">
            <!-- Brand / Title -->
            <div class="toolbar-brand">
                <p class="app-title">Joinery</p>
            </div>

            <!-- Middle: Tab Switcher (Responsive) -->
            <div class="toolbar-middle">
                <div class="dropdown w-100">
                    <button id="tabSwitchDropdownBtn" class="btn btn-base dropdown-toggle d-flex align-items-center w-100 justify-content-between" type="button" 
                            data-bs-toggle="dropdown" aria-expanded="false" title="Switch tab">
                        <div class="d-flex align-items-center overflow-hidden">
                            <i class="bi bi-window-stack flex-shrink-0"></i>
                            <span class="toolbar-btn-text ms-2"></span>
                        </div>
                    </button>
                    <ul id="tabSwitchDropdownMenu" class="dropdown-menu dropdown-menu-end w-100">
                        <!-- Populated dynamically -->
                    </ul>
                </div>
            </div>

            <!-- Right: Actions -->
            <div class="toolbar-actions">
                <!-- Keyboard Shortcuts -->
                <button id="keyboardShortcutsBtn" class="btn btn-base" title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
                    <i class="bi bi-keyboard"></i>
                </button>
                
                <!-- Theme Toggle -->
                <button id="themeToggleBtn" class="btn btn-base" title="Toggle theme" aria-label="Toggle theme">
                    <i class="bi bi-moon"></i>
                </button>
                
                <!-- GitHub Link -->
                <button id="githubBtn" class="btn btn-base" title="View on GitHub" aria-label="View on GitHub">
                    <i class="bi bi-github"></i>
                </button>
            </div>
        </div>
    `;

    const container = getContainerFluid();
    if (container) {
        container.insertBefore(toolbar, container.firstChild);
    }
}

/**
 * Create and inject navigation tabs structure
 */
export function createNavigationTabs() {
    const tabsHtml = `
        <!-- Navigation Tabs -->
        <ul class="nav" id="tabList">
            <li class="nav-item">
                <a class="nav-link active" id="schema" data-bs-toggle="tab" href="#content-1" role="tab">
                    <i class="bi bi-database"></i>
                    <span class="tab-title">Database</span>
                </a>
            </li>
            <li class="nav-item add-tab">
                <a class="nav-link" id="addTab" title="New query tab">
                    <i class="bi bi-plus-lg"></i>
                </a>
            </li>
        </ul>

        <!-- Tab Content -->
        <div class="tab-content" id="tabContent">
            <!-- Database Tab -->
            <div class="tab-pane fade show active" id="content-1" role="tabpanel">
                <div class="masonry" id="dbMasonry"></div>
            </div>
        </div>
    `;

    const container = getContainerFluid();
    if (container) {
        container.insertAdjacentHTML('beforeend', tabsHtml);
    }
}

/**
 * Create and inject all database tab cards
 */
export function createDatabaseTabCards() {
    const masonry = getCachedElement('dbMasonry');
    if (!masonry) return;

    // Use DocumentFragment for batch DOM operations
    const fragment = document.createDocumentFragment();

    // Database Management Card (first card)
    fragment.appendChild(createDatabaseManagementCard());

    // Quick Start Card
    fragment.appendChild(createQuickStartCard());

    // Tables Card
    fragment.appendChild(createTablesCard());

    // Upload Card
    fragment.appendChild(createUploadCard());

    // Copy Schema Card
    fragment.appendChild(createCopySchemaCard());

    // Append all cards at once
    masonry.appendChild(fragment);
}

// Lazy Modal Loading

/**
 * Modal HTML templates - only created when needed
 */
const MODAL_TEMPLATES = {
    saveResultModal: () => `
        <div class="modal fade" id="saveResultModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <p class="modal-title label-title">
                            <i class="bi bi-floppy me-2"></i>Save to Database
                        </p>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div id="saveResultBody"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-base secondary" data-bs-dismiss="modal">Cancel</button>
                        <button id="saveResultConfirmBtn" class="btn btn-base primary">
                            <i class="bi bi-check-lg"></i> Save
                        </button>
                    </div>
                </div>
            </div>
        </div>`,

    schemaTypeModal: () => `
        <div class="modal fade" id="schemaTypeModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <p class="modal-title label-title">
                            <i class="bi bi-sliders me-2"></i>Change Data Types
                        </p>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div id="schemaTypeBody"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-base secondary" data-bs-dismiss="modal">Cancel</button>
                        <button id="schemaTypeSaveBtn" class="btn btn-base primary">
                            <i class="bi bi-check-circle"></i> Validate &amp; Save
                        </button>
                    </div>
                </div>
            </div>
        </div>`,

    nameQueriesModal: () => `
        <div class="modal fade" id="nameQueriesModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable modal-fullscreen-md-down modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <p class="modal-title label-title">
                            <i class="bi bi-bookmark-plus me-2"></i>Name Saved Queries
                        </p>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div id="splitQueriesToggleWrap" class="mb-3" style="display:none;">
                            <div class="form-check form-check-base form-switch">
                                <input class="form-check-input" type="checkbox" id="splitQueriesChk" checked>
                                <label class="form-check-label" for="splitQueriesChk">Split queries</label>
                            </div>
                        </div>
                        <div class="table-responsive">
                        <table class="table table-base table-sm no-row-hover saved-queries-table mb-0" id="nameQueriesTable">
                                <thead>
                                    <tr>
                                        <th class="col-query">Query</th>
                                        <th class="col-name">Name</th>
                                        <th class="col-folder">Folder</th>
                                        <th class="col-params">Parameters</th>
                                        <th class="col-action">Action</th>
                                    </tr>
                                </thead>
                                <tbody id="nameQueriesBody"></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-base secondary" data-bs-dismiss="modal">Cancel</button>
                        <button id="saveQueriesBtn" class="btn btn-base primary">
                            <i class="bi bi-check-all"></i> Save All
                        </button>
                    </div>
                </div>
            </div>
        </div>`,

    renameTableModal: () => `
        <div class="modal fade" id="renameTableModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <p class="modal-title label-title">
                            <i class="bi bi-pencil-square me-2"></i>Rename Table
                        </p>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="currentTableName" class="form-label label-base">Current Name</label>
                            <input type="text" class="form-control form-control-base" id="currentTableName" readonly disabled>
                        </div>
                        <div class="mb-3">
                            <label for="newTableName" class="form-label label-base">New Name</label>
                            <input type="text" class="form-control form-control-base" id="newTableName" placeholder="Enter new table name" autocomplete="off">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-base secondary" data-bs-dismiss="modal">Cancel</button>
                        <button id="renameTableSaveBtn" class="btn btn-base primary">
                            <i class="bi bi-check-lg"></i> Rename
                        </button>
                    </div>
                </div>
            </div>
        </div>`,

    keyboardShortcutsModal: () => `
        <div class="modal fade" id="keyboardShortcutsModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <p class="modal-title label-title">
                            <i class="bi bi-keyboard me-2"></i>Keyboard Shortcuts
                        </p>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <table class="table table-base table-sm mb-0">
                            <thead>
                                <tr>
                                    <th>Action</th>
                                    <th>Shortcut</th>
                                    <th>Scope</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>Run Query</td>
                                    <td><kbd>Ctrl</kbd> + <kbd>Enter</kbd></td>
                                    <td><span class="badge bg-secondary">Query Editor</span></td>
                                </tr>
                                <tr>
                                    <td>Save Query</td>
                                    <td><kbd>Ctrl</kbd> + <kbd>S</kbd></td>
                                    <td><span class="badge bg-secondary">Query Editor</span></td>
                                </tr>
                                <tr>
                                    <td>Toggle Comment</td>
                                    <td><kbd>Ctrl</kbd> + <kbd>/</kbd></td>
                                    <td><span class="badge bg-secondary">Query Editor</span></td>
                                </tr>
                                <tr>
                                    <td>Toggle Block Comment</td>
                                    <td><kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>A</kbd></td>
                                    <td><span class="badge bg-secondary">Query Editor</span></td>
                                </tr>
                                <tr>
                                    <td>Trigger Suggestions</td>
                                    <td><kbd>Ctrl</kbd> + <kbd>Space</kbd></td>
                                    <td><span class="badge bg-secondary">Query Editor</span></td>
                                </tr>
                                <tr>
                                    <td>Format SQL</td>
                                    <td><kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd></td>
                                    <td><span class="badge bg-secondary">Query Editor</span></td>
                                </tr>
                                <tr>
                                    <td>Upload Files</td>
                                    <td><kbd>Ctrl</kbd> + <kbd>O</kbd></td>
                                    <td><span class="badge bg-primary">Global</span></td>
                                </tr>
                                <tr>
                                    <td>Tab Switcher</td>
                                    <td><kbd>Ctrl</kbd> + <kbd>K</kbd></td>
                                    <td><span class="badge bg-primary">Global</span></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-base secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>`

};

/**
 * Ensure a modal exists in the DOM (lazy loading)
 * @param {string} modalId - Modal ID (e.g., 'saveResultModal')
 * @returns {HTMLElement|null} The modal element
 */
export function ensureModal(modalId) {
    // Check if already in DOM
    let modal = document.getElementById(modalId);
    if (modal) return modal;

    // Check if template exists
    const templateFn = MODAL_TEMPLATES[modalId];
    if (!templateFn) {
        console.warn(`No template found for modal: ${modalId}`);
        return null;
    }

    // Create and inject modal
    document.body.insertAdjacentHTML('beforeend', templateFn());

    return document.getElementById(modalId);
}

// Card Generators (Private Helpers)

/**
 * Create Tables Card
 * @returns {HTMLElement} Tables card element
 */
function createTablesCard() {
    const card = document.createElement('div');
    card.className = 'masonry-item';
    card.id = 'tablesCard';
    card.style.display = 'none';
    card.innerHTML = `
        <div class="card card-base">
            <div class="card-body">
                <div class="d-flex align-items-center justify-content-between mb-4">
                    <p class="label-title mb-0">
                        <i class="bi bi-table me-2" ></i>Tables
                    </p>
                </div>
                <div id="schemaDropdownContainer" style="display:none;">
                    <label class="form-label label-base mb-1">Select Schema</label>
                    <div id="schemaTreeSelectContainer" class="mb-3"></div>
                </div>
                <div id="tablesCardOverlayZone" class="loading-overlay-zone">
                    <div id="tableDropdownContainer" style="display:none;">
                        <label class="form-label label-base mb-1">Select Table</label>
                        <div id="tableTreeSelectContainer" class="mb-3"></div>
                    </div>
                    <div id="tableSchemaOverlayZone" class="loading-overlay-zone">
                        <div id="tableSchema" class="mt-3"></div>
                        <div id="tableSchemaOverlay" class="loading-overlay">
                            <div class="loading-overlay-spinner"></div>
                            <span class="loading-overlay-text"></span>
                        </div>
                    </div>
                    <div id="tablesCardOverlay" class="loading-overlay">
                        <div class="loading-overlay-spinner"></div>
                        <span class="loading-overlay-text"></span>
                    </div>
                </div>
            </div>
        </div>
    `;
    return card;
}

/**
 * Create Upload Card
 * @returns {HTMLElement} Upload card element
 */
function createUploadCard() {
    const card = document.createElement('div');
    card.className = 'masonry-item';
    card.id = 'uploadCard';
    card.innerHTML = `
        <div class="card card-base">
            <div class="card-body">
                <p class="label-title mb-4">
                    <i class="bi bi-cloud-arrow-up me-2" ></i>Upload Files
                </p>
                <div class="mb-3">
                    <span class="label-base">Supported formats:</span>
                    <p class="label-muted d-inline ms-1">xlsx, csv, json, parquet, zip, and more.</p>
                </div>
                <div class="form-check form-check-base form-switch mb-3">
                    <input class="form-check-input" type="checkbox" id="inferTypesChk" checked>
                    <label class="form-check-label" for="inferTypesChk">Infer column types automatically</label>
                </div>
                <div id="dropZone" class="drop-zone-base mb-3" tabindex="0" role="button"
                     aria-label="Drop files here or click to select">
                    <i class="bi bi-cloud-arrow-up"></i>
                    <div class="mt-2 fw-medium">Drop files here or click to browse</div>
                </div>
                <div class="d-flex gap-2">
                    <button id="fileUploadBtn" class="btn btn-base w-100" title="Choose files">
                        <i class="bi bi-folder2-open"></i>&nbsp;Browse Files
                    </button>
                    <input type="file" id="fileInput"
                           accept=".xlsx,.xls,.csv,.json,.parquet,.tsv,.txt,.xlsb,.tab,.psv,.log,.dat,.data,.zip" multiple hidden />
                </div>
            </div>
        </div>
    `;
    return card;
}

/**
 * Create Copy Schema Card
 * @returns {HTMLElement} Copy schema card element
 */
function createCopySchemaCard() {
    const card = document.createElement('div');
    card.className = 'masonry-item';
    card.id = 'copySchemaCol';
    card.style.display = 'none';
    card.innerHTML = `
        <div class="card card-base">
            <div class="card-body">
                <p class="label-title mb-4">
                    <i class="bi bi-clipboard-data me-2" ></i>Copy Schema
                </p>
                <div class="mb-3">
                    <p class="label-muted d-inline">Generate </p>
                    <code class="label-base">CREATE TABLE</code> 
                    <p class="label-muted d-inline"> and </p>
                    <code class="label-base">INSERT INTO</code> 
                    <p class="label-muted d-inline"> statements.</p>
                </div>
                <div class="row g-2 align-items-center mb-3">
                    <div class="col-auto">
                        <label for="schemaSampleRowsInput" class="label-base mb-0">Sample Rows</label>
                    </div>
                    <div class="col-auto">
                        <input type="number" id="schemaSampleRowsInput" class="form-control form-control-base" min="0"
                               step="1" value="3" style="width: 5rem;"
                               aria-label="Number of sample rows per table" />
                    </div>
                </div>
                <div class="d-flex">
                    <button id="copySchemaButton" class="btn btn-base primary-outline w-100">
                        <i class="bi bi-clipboard"></i>&nbsp;Copy to Clipboard
                    </button>
                </div>
            </div>
        </div>
    `;
    return card;
}

/**
 * Create Quick Start Card
 * @returns {HTMLElement} Quick start card element
 */
function createQuickStartCard() {
    const card = document.createElement('div');
    card.className = 'masonry-item';
    card.id = 'quickStartCard';
    card.style.display = 'none';
    card.innerHTML = `
        <div class="card card-base">
            <div class="card-body">
                <p class="label-title mb-4">
                    <i class="bi bi-rocket-takeoff me-2" ></i>Quick Start
                </p>
                <div class="mb-3">
                    <span class="label-base">New to the app?</span>
                    <p class="label-muted d-inline ms-1">Explore the docs or load sample data.</p>
                </div>
                <div class="d-flex flex-column gap-3">
                    <button id="quickStartDocsBtn" class="btn btn-base w-100">
                        <i class="bi bi-book"></i>&nbsp;Read Documentation
                    </button>
                    <button id="quickStartBtn" class="btn btn-base w-100">
                        <i class="bi bi-play-circle"></i>&nbsp;Try Example
                    </button>
                </div>
            </div>
        </div>
    `;
    return card;
}

/**
 * Create Database Management Card
 * Contains database selector and action buttons (export, import, reset)
 * Note: Save button removed - database auto-saves via checkpoint manager
 * @returns {HTMLElement} Database management card element
 */
function createDatabaseManagementCard() {
    const card = document.createElement('div');
    card.className = 'masonry-item';
    card.id = 'dbManagementCard';
    card.innerHTML = `
        <div class="card card-base">
            <div class="card-body">
                <p class="label-title mb-4">
                    <i class="bi bi-database-check me-2" ></i>Database
                </p>
                <div class="mb-3">
                    <label class="form-label label-base mb-1">Active Database</label>
                    <div id="dbSelectContainer"></div>
                </div>
                <div class="d-flex flex-wrap gap-2">
                    <label class="btn btn-base flex-fill" title="Import database">
                        <i class="bi bi-upload"></i>
                        <span>Import</span>
                        <input type="file" id="importDbInput" accept=".db,.duckdb" hidden />
                    </label>
                    <button id="exportDbBtn" class="btn btn-base flex-fill" title="Export database">
                        <i class="bi bi-download"></i>
                        <span>Export</span>
                    </button>
                    <button id="resetDbBtn" class="btn btn-base danger flex-fill" title="Delete database">
                        <i class="bi bi-trash"></i>
                        <span>Delete</span>
                    </button>
                </div>
            </div>
        </div>
    `;
    return card;
}

// Toolbar Initialization

/**
 * Initialize toolbar button handlers
 * - Keyboard shortcuts modal
 * - Tab switch dropdown
 */
export function initToolbar() {
    // Keyboard shortcuts button
    const shortcutsBtn = document.getElementById('keyboardShortcutsBtn');
    if (shortcutsBtn) {
        shortcutsBtn.addEventListener('click', () => {
            const modalEl = ensureModal('keyboardShortcutsModal');
            if (modalEl) {
                const modal = new Modal(modalEl);
                modal.show();
            }
        });
    }

    // GitHub button
    const githubBtn = document.getElementById('githubBtn');
    if (githubBtn) {
        githubBtn.addEventListener('click', () => {
            openUrl('https://github.com/joinery-labs/joinery');
        });
    }

    // Tab switch dropdown - populate on show
    const dropdownBtn = document.getElementById('tabSwitchDropdownBtn');
    if (dropdownBtn) {
        dropdownBtn.addEventListener('show.bs.dropdown', populateTabDropdown);
    }

    // Handle tab dropdown item clicks via event delegation
    const dropdownMenu = document.getElementById('tabSwitchDropdownMenu');
    if (dropdownMenu) {
        dropdownMenu.addEventListener('click', (e) => {
            const item = e.target.closest('[data-tab-target]');
            if (item) {
                e.preventDefault();
                const tabId = item.dataset.tabTarget;
                const tabEl = document.getElementById(tabId);
                if (tabEl) {
                    const { Tab } = window.bootstrap || {};
                    if (Tab) {
                        new Tab(tabEl).show();
                    } else {
                        // Fallback: trigger click
                        tabEl.click();
                    }
                }
            }
        });
    }

    // Initialize active tab label updater
    initActiveTabLabelUpdater();
}


/**
 * Populate tab switch dropdown with current tabs
 */
function populateTabDropdown() {
    const menu = document.getElementById('tabSwitchDropdownMenu');
    if (!menu) return;

    const tabs = document.querySelectorAll('#tabList .nav-link:not(#addTab)');
    const activeTabId = document.querySelector('#tabList .nav-link.active')?.id;

    menu.innerHTML = '';

    tabs.forEach(tab => {
        const title = tab.querySelector('.tab-title')?.textContent || tab.textContent.trim();
        const isActive = tab.id === activeTabId;
        const icon = tab.querySelector('i')?.className || 'bi bi-file-earmark';

        const li = document.createElement('li');
        li.innerHTML = `
            <a class="dropdown-item d-flex align-items-center" href="#" data-tab-target="${tab.id}" title="${escapeHTMLForDropdown(title)}">
                <i class="${icon.split(' ').slice(0, 2).join(' ')} me-2"></i>
                <span class="text-truncate flex-grow-1">${escapeHTMLForDropdown(title)}</span>
                ${isActive ? '<i class="bi bi-check-lg ms-auto ps-2"></i>' : ''}
            </a>
        `;
        menu.appendChild(li);
    });
}

/**
 * Initialize active tab label updater
 * and setup observers for changes
 */
function initActiveTabLabelUpdater() {
    // Initial update
    updateActiveTabLabel();

    // Listen for tab changes (bootstrap event)
    // We attach to document because tabs might be dynamic
    document.addEventListener('shown.bs.tab', (e) => {
        // Only react if the event target is part of our main tab list
        if (e.target.closest('#tabList')) {
            updateActiveTabLabel();
        }
    });

    // Observe tab list for renaming (DOM mutations)
    const tabList = document.getElementById('tabList');
    if (tabList) {
        const observer = new MutationObserver(() => {
            // Debounce slightly or just run
            updateActiveTabLabel();
        });

        observer.observe(tabList, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['title', 'data-tab-title']
        });
    }
}

/**
 * Update the toolbar button label with the active tab's title
 */
function updateActiveTabLabel() {
    const activeTab = document.querySelector('#tabList .nav-link.active');
    const updateBtn = document.getElementById('tabSwitchDropdownBtn');
    const labelSpan = updateBtn?.querySelector('.toolbar-btn-text');

    if (activeTab && updateBtn && labelSpan) {
        const titleSpan = activeTab.querySelector('.tab-title');


        let text = "Select Tab";
        if (titleSpan) {
            text = titleSpan.textContent || titleSpan.title;
        } else {
            // Handle cases where tab is being renamed (input field present)
            // or if it's a static tab without a .tab-title span
            const input = activeTab.querySelector('input');
            if (input) text = input.value;
            else text = activeTab.textContent.trim();
        }

        labelSpan.textContent = text;
        updateBtn.title = `Switch tab: ${text}`;
    }
}

/**
 * Escape HTML for dropdown items
 */
function escapeHTMLForDropdown(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
