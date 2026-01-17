/**
 * TreeSelect - A powerful, searchable multi-level dropdown component
 * 
 * Features:
 * - Single and multi-select modes
 * - Hierarchical tree structure with expand/collapse
 * - Fuzzy search with debouncing
 * - Keyboard navigation (Arrow keys, Enter, Escape, Ctrl+A)
 * - Disabled options support
 * - Flat mode (no hierarchy UI)
 * - Flatten search results option
 * - Auto-select/deselect descendants
 * - Value filtering (ALL, LEAF, BRANCH_PRIORITY)
 * - Event callbacks (change, open, close, search)
 * 
 * Usage:
 * ```javascript
 * import { TreeSelect } from './ui/treeselect.js';
 * 
 * const treeselect = new TreeSelect('#container', {
 *     data: [
 *         {
 *             id: 1,
 *             label: 'Parent Node',
 *             children: [
 *                 { id: 2, label: 'Child 1' },
 *                 { id: 3, label: 'Child 2', disabled: true }
 *             ]
 *         }
 *     ],
 *     multiple: true,
 *     placeholder: 'Select...',
 *     searchable: true,
 *     clearable: true,
 *     flattenSearchResults: false,
 *     valueConsistsOf: 'LEAF',
 *     flat: false
 * });
 * 
 * // Get selected values
 * const values = treeselect.getValue();
 * 
 * // Set values programmatically
 * treeselect.setValue([2, 3]);
 * 
 * // Listen for changes
 * treeselect.on('change', (values) => {
 *     console.log('Selected:', values);
 * });
 * ```
 */

"use strict";

export class TreeSelect {
    static CONSTANTS = Object.freeze({
        DEFAULT_MAX_HEIGHT: 300,
        DEFAULT_NODE_HEIGHT: 36,
        SEARCH_DEBOUNCE_MS: 150,
        MAX_VISIBLE_TAGS: 3,
        ANIMATION_DELAY_MS: 50,
        SCROLL_BEHAVIOR: 'smooth',
        MAX_SAFE_NODES: 10000
    });

    static defaults = Object.freeze({
        data: [],
        multiple: false,
        placeholder: 'Select...',
        searchable: true,
        clearable: true,
        disabled: false,
        flattenSearchResults: false,
        valueConsistsOf: 'ALL',
        openOnFocus: true,
        closeOnSelect: true,
        maxHeight: TreeSelect.CONSTANTS.DEFAULT_MAX_HEIGHT,
        noResultsText: 'No results found',
        noOptionsText: 'No options available',
        loadingText: 'Loading...',
        autoSelectAncestors: false,
        autoSelectDescendants: true,
        autoDeselectAncestors: false,
        autoDeselectDescendants: true,
        flat: false,
        icon: null,
        useFixedPosition: false,
        expandAll: false
    });

    static #validValueConsistsOf = new Set(['ALL', 'BRANCH_PRIORITY', 'LEAF', 'ALL_WITH_INDETERMINATE']);

    #abortController = null;
    #searchDebounceTimer = null;
    #nodeElementMap = new Map();
    #boundHandleOutsideClick = null;
    #boundUpdateMenuPosition = null;
    #scrollParents = [];

    constructor(element, options = {}) {
        this.container = typeof element === 'string'
            ? document.querySelector(element)
            : element;

        if (!this.container) {
            throw new Error('TreeSelect: Container element not found');
        }

        this.options = { ...TreeSelect.defaults, ...options };
        this.#validateOptions();

        this.isOpen = false;
        this.isDisabled = this.options.disabled;
        this.searchQuery = '';
        this.highlightedNodeId = null;
        this.selectedValues = new Map();
        this.flatNodes = new Map();
        this.visibleNodes = [];
        this.temporaryHighlightedIds = new Set();

        this.callbacks = {
            change: [],
            open: [],
            close: [],
            search: []
        };

        this.#abortController = new AbortController();
        this.#boundHandleOutsideClick = this.#handleOutsideClick.bind(this);
        this.#boundUpdateMenuPosition = this.#updateMenuPosition.bind(this);

        this.#processData(this.options.data);
        this.#render();
        this.#bindEvents();
    }

    #validateOptions() {
        if (!TreeSelect.#validValueConsistsOf.has(this.options.valueConsistsOf)) {
            console.warn(`TreeSelect: Invalid valueConsistsOf "${this.options.valueConsistsOf}". Using "ALL".`);
            this.options.valueConsistsOf = 'ALL';
        }

        if (!Array.isArray(this.options.data)) {
            console.warn('TreeSelect: data must be an array. Using empty array.');
            this.options.data = [];
        }
    }

    destroy() {
        this.#abortController?.abort();

        if (this.#searchDebounceTimer) {
            clearTimeout(this.#searchDebounceTimer);
            this.#searchDebounceTimer = null;
        }

        document.removeEventListener('click', this.#boundHandleOutsideClick);

        // Cleanup fixed position listeners
        this.#removePositionListeners();

        this.#nodeElementMap.clear();
        this.flatNodes.clear();
        this.selectedValues.clear();
        this.temporaryHighlightedIds.clear();
        this.visibleNodes.length = 0;

        Object.values(this.callbacks).forEach(arr => arr.length = 0);

        // Remove menu from body if using fixed position
        if (this.options.useFixedPosition && this.menu && this.menu.parentNode === document.body) {
            document.body.removeChild(this.menu);
        }

        this.container.innerHTML = '';
        this.container.classList.remove('treeselect', 'is-open', 'is-disabled', 'is-flat');

        this.control = null;
        this.menu = null;
        this.valueContainer = null;
        this.clearBtn = null;
        this.searchInput = null;
        this.treeContainer = null;
    }

    #processData(data, parent = null, level = 0) {
        if (!Array.isArray(data)) return;
        if (this.flatNodes.size > TreeSelect.CONSTANTS.MAX_SAFE_NODES) {
            console.warn('TreeSelect: Maximum safe node count exceeded');
            return;
        }

        for (let i = 0, len = data.length; i < len; i++) {
            const node = data[i];
            if (!node || node.id === undefined || node.label === undefined) {
                continue;
            }

            const hasChildren = node.children?.length > 0;
            const normalizedNode = {
                id: node.id,
                label: node.label,
                disabled: Boolean(node.disabled),
                isLeaf: !hasChildren,
                level,
                parent,
                children: hasChildren ? node.children.map(c => c.id) : [],
                isExpanded: this.options.expandAll && hasChildren,
                isVisible: true,
                isMatched: false
            };

            this.flatNodes.set(node.id, normalizedNode);

            if (hasChildren) {
                this.#processData(node.children, node.id, level + 1);
            }
        }
    }

    #render() {
        this.container.innerHTML = '';
        this.container.classList.add('treeselect');

        if (this.options.flat) {
            this.container.classList.add('is-flat');
        }

        this.control = this.#createControl();
        this.container.appendChild(this.control);

        this.menu = this.#createMenu();

        // For fixed positioning, append menu to body instead of container
        if (this.options.useFixedPosition) {
            this.menu.classList.add('is-fixed');
            document.body.appendChild(this.menu);
        } else {
            this.container.appendChild(this.menu);
        }

        this.#updateDisplay();
    }

    #createControl() {
        const control = document.createElement('div');
        control.className = 'treeselect-control';
        control.setAttribute('role', 'combobox');
        control.setAttribute('aria-haspopup', 'tree');
        control.setAttribute('aria-expanded', 'false');
        control.tabIndex = 0;

        // Add leading icon if specified
        if (this.options.icon) {
            const leadingIcon = document.createElement('i');
            leadingIcon.className = `${this.options.icon} treeselect-leading-icon`;
            control.appendChild(leadingIcon);
        }

        const valueContainer = document.createElement('div');
        valueContainer.className = 'treeselect-value-container';
        control.appendChild(valueContainer);
        this.valueContainer = valueContainer;

        const icons = document.createElement('div');
        icons.className = 'treeselect-icons';

        if (this.options.clearable) {
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'treeselect-clear';
            clearBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
            clearBtn.style.display = 'none';
            clearBtn.setAttribute('aria-label', 'Clear selection');
            icons.appendChild(clearBtn);
            this.clearBtn = clearBtn;
        }

        const arrow = document.createElement('span');
        arrow.className = 'treeselect-arrow';
        arrow.innerHTML = '<i class="bi bi-chevron-down"></i>';
        icons.appendChild(arrow);

        control.appendChild(icons);

        return control;
    }

    #createMenu() {
        const menu = document.createElement('div');
        menu.className = 'treeselect-menu';
        menu.setAttribute('role', 'listbox');

        if (this.options.searchable) {
            const searchWrapper = document.createElement('div');
            searchWrapper.className = 'treeselect-search-wrapper';

            const searchIcon = document.createElement('i');
            searchIcon.className = 'bi bi-search treeselect-search-icon';
            searchWrapper.appendChild(searchIcon);

            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.className = 'treeselect-search';
            searchInput.placeholder = 'Search...';
            searchInput.setAttribute('aria-label', 'Search options');
            searchWrapper.appendChild(searchInput);
            this.searchInput = searchInput;

            menu.appendChild(searchWrapper);
        }

        const tree = document.createElement('div');
        tree.className = 'treeselect-tree';
        tree.setAttribute('role', 'tree');
        menu.appendChild(tree);
        this.treeContainer = tree;

        this.#renderTree();

        return menu;
    }

    #renderTree() {
        this.treeContainer.innerHTML = '';
        this.visibleNodes.length = 0;
        this.#nodeElementMap.clear();

        const rootNodes = [];
        for (const node of this.flatNodes.values()) {
            if (node.parent === null) rootNodes.push(node);
        }

        if (rootNodes.length === 0) {
            this.#renderEmpty();
            return;
        }

        if (this.searchQuery && this.options.flattenSearchResults) {
            this.#renderFlatSearchResults();
        } else {
            const fragment = document.createDocumentFragment();
            for (let i = 0, len = rootNodes.length; i < len; i++) {
                this.#renderNode(rootNodes[i], fragment);
            }
            this.treeContainer.appendChild(fragment);
        }

        if (this.searchQuery && this.visibleNodes.length === 0) {
            this.#renderNoResults();
        }
    }

    #renderNode(node, container) {
        if (!node.isVisible && this.searchQuery) return;

        this.visibleNodes.push(node.id);

        const nodeEl = document.createElement('div');
        nodeEl.className = 'treeselect-node';
        nodeEl.dataset.id = node.id;

        this.#nodeElementMap.set(node.id, nodeEl);

        if (this.selectedValues.has(node.id)) {
            nodeEl.classList.add('is-selected');
        }
        if (node.disabled) {
            nodeEl.classList.add('is-disabled');
        }
        if (node.id === this.highlightedNodeId || this.temporaryHighlightedIds.has(node.id)) {
            nodeEl.classList.add('is-highlighted');
        }
        if (node.isExpanded) {
            nodeEl.classList.add('is-expanded');
        }
        if (this.options.multiple && this.#isIndeterminate(node)) {
            nodeEl.classList.add('is-indeterminate');
        }

        const content = document.createElement('div');
        content.className = 'treeselect-node-content';

        if (this.options.flat) {
            content.style.paddingLeft = '0.75rem';
        } else {
            content.style.paddingLeft = `${0.75 + node.level * 1.25}rem`;
        }

        if (!this.options.flat) {
            if (!node.isLeaf) {
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'treeselect-toggle';
                toggle.innerHTML = '<i class="bi bi-chevron-right"></i>';
                toggle.setAttribute('aria-label', 'Toggle children');
                content.appendChild(toggle);
            } else {
                const placeholder = document.createElement('span');
                placeholder.className = 'treeselect-toggle-placeholder';
                content.appendChild(placeholder);
            }
        }

        if (this.options.multiple) {
            const checkbox = document.createElement('span');
            checkbox.className = 'treeselect-checkbox';
            checkbox.innerHTML = '<i class="bi bi-check"></i>';
            content.appendChild(checkbox);
        } else {
            const radio = document.createElement('span');
            radio.className = 'treeselect-radio';
            content.appendChild(radio);
        }

        const label = document.createElement('span');
        label.className = 'treeselect-label';

        if (this.searchQuery && node.isMatched) {
            label.innerHTML = this.#highlightMatch(node.label, this.searchQuery);
        } else {
            label.textContent = node.label;
        }
        content.appendChild(label);

        nodeEl.appendChild(content);

        if (!node.isLeaf) {
            if (this.options.flat) {
                const children = node.children;
                for (let i = 0, len = children.length; i < len; i++) {
                    const childNode = this.flatNodes.get(children[i]);
                    if (childNode) {
                        this.#renderNode(childNode, container);
                    }
                }
            } else {
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'treeselect-children';

                const children = node.children;
                for (let i = 0, len = children.length; i < len; i++) {
                    const childNode = this.flatNodes.get(children[i]);
                    if (childNode) {
                        this.#renderNode(childNode, childrenContainer);
                    }
                }

                nodeEl.appendChild(childrenContainer);
            }
        }

        container.appendChild(nodeEl);
    }

    #renderFlatSearchResults() {
        const wrapper = document.createElement('div');
        wrapper.className = 'treeselect-flat-list';

        for (const [id, node] of this.flatNodes) {
            if (!node.isMatched) continue;

            const nodeEl = document.createElement('div');
            nodeEl.className = 'treeselect-node';
            nodeEl.dataset.id = id;

            this.#nodeElementMap.set(id, nodeEl);

            if (this.selectedValues.has(id)) {
                nodeEl.classList.add('is-selected');
            }
            if (node.disabled) {
                nodeEl.classList.add('is-disabled');
            }
            if (this.temporaryHighlightedIds.has(id)) {
                nodeEl.classList.add('is-highlighted');
            }

            const content = document.createElement('div');
            content.className = 'treeselect-node-content';

            if (this.options.multiple) {
                const checkbox = document.createElement('span');
                checkbox.className = 'treeselect-checkbox';
                checkbox.innerHTML = '<i class="bi bi-check"></i>';
                content.appendChild(checkbox);
            } else {
                const radio = document.createElement('span');
                radio.className = 'treeselect-radio';
                content.appendChild(radio);
            }

            const labelWrapper = document.createElement('span');
            labelWrapper.className = 'treeselect-label';

            const labelSpan = document.createElement('span');
            labelSpan.innerHTML = this.#highlightMatch(node.label, this.searchQuery);
            labelWrapper.appendChild(labelSpan);

            const path = this.#getNodePath(node);
            if (path.length > 1) {
                const pathEl = document.createElement('span');
                pathEl.className = 'treeselect-path';
                pathEl.textContent = path.slice(0, -1).join(' › ');
                labelWrapper.appendChild(pathEl);
            }

            content.appendChild(labelWrapper);
            nodeEl.appendChild(content);
            wrapper.appendChild(nodeEl);

            this.visibleNodes.push(id);
        }

        this.treeContainer.appendChild(wrapper);
    }

    #getNodePath(node) {
        const path = [node.label];
        let current = node;
        while (current.parent !== null) {
            current = this.flatNodes.get(current.parent);
            if (current) {
                path.unshift(current.label);
            } else {
                break;
            }
        }
        return path;
    }

    #highlightMatch(text, query) {
        if (!query) return text;
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedQuery})`, 'gi');
        return text.replace(regex, '<span class="treeselect-label-match">$1</span>');
    }

    #renderEmpty() {
        const empty = document.createElement('div');
        empty.className = 'treeselect-empty';
        empty.innerHTML = `<i class="bi bi-inbox"></i><span>${this.options.noOptionsText}</span>`;
        this.treeContainer.appendChild(empty);
    }

    #renderNoResults() {
        this.treeContainer.innerHTML = '';
        const noResults = document.createElement('div');
        noResults.className = 'treeselect-no-results';
        noResults.innerHTML = `<i class="bi bi-search me-2"></i>${this.options.noResultsText}`;
        this.treeContainer.appendChild(noResults);
    }

    #bindEvents() {
        const signal = this.#abortController.signal;

        this.control.addEventListener('click', (e) => {
            if (this.isDisabled) return;
            if (e.target.closest('.treeselect-clear')) {
                this.clear();
                e.stopPropagation();
                return;
            }
            this.toggle();
        }, { signal });

        this.control.addEventListener('keydown', (e) => this.#handleKeydown(e), { signal });

        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                this.#debouncedSearch(e.target.value);
            }, { signal });

            this.searchInput.addEventListener('keydown', (e) => this.#handleKeydown(e), { signal });
        }

        this.treeContainer.addEventListener('click', (e) => {
            const toggle = e.target.closest('.treeselect-toggle');
            const nodeEl = e.target.closest('.treeselect-node');

            if (!nodeEl) return;

            const nodeId = nodeEl.dataset.id;
            const node = this.flatNodes.get(nodeId);

            if (!node) return;

            if (toggle) {
                this.#toggleNode(node);
                e.stopPropagation();
            } else if (!node.disabled) {
                this.#selectNode(node);
            }
        }, { signal });

        document.addEventListener('click', this.#boundHandleOutsideClick);

        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clear();
            }, { signal });
        }
    }

    #handleOutsideClick(e) {
        if (this.isOpen && !this.container.contains(e.target) && !this.menu.contains(e.target)) {
            this.close();
        }
    }

    #debouncedSearch(query) {
        if (this.#searchDebounceTimer) {
            clearTimeout(this.#searchDebounceTimer);
        }

        this.#searchDebounceTimer = setTimeout(() => {
            this.#search(query);
            this.#searchDebounceTimer = null;
        }, TreeSelect.CONSTANTS.SEARCH_DEBOUNCE_MS);
    }

    #handleKeydown(e) {
        if (this.isDisabled) return;

        const key = e.key.toLowerCase();

        if ((e.ctrlKey || e.metaKey) && key === 'a') {
            if (this.options.multiple && this.isOpen) {
                e.preventDefault();
                e.stopPropagation();
                this.#highlightAllVisible();
            }
            return;
        }

        if (['arrowdown', 'arrowup', 'arrowleft', 'arrowright'].includes(key)) {
            if (this.temporaryHighlightedIds.size > 0) {
                this.#clearTemporaryHighlights();
            }
        }

        switch (e.key) {
            case 'Enter':
            case ' ':
                if (e.key === ' ' && e.target === this.searchInput) {
                    return;
                }
                if (!this.isOpen) {
                    this.open();
                } else if (this.temporaryHighlightedIds.size > 0) {
                    this.#selectTemporaryHighlighted();
                } else if (this.highlightedNodeId) {
                    const node = this.flatNodes.get(this.highlightedNodeId);
                    if (node && !node.disabled) {
                        this.#selectNode(node);
                    }
                }
                e.preventDefault();
                break;

            case 'Escape':
                this.close();
                this.control.focus();
                e.preventDefault();
                break;

            case 'ArrowDown':
                if (!this.isOpen) {
                    this.open();
                } else {
                    this.#highlightNext();
                }
                e.preventDefault();
                break;

            case 'ArrowUp':
                if (this.isOpen) {
                    this.#highlightPrev();
                }
                e.preventDefault();
                break;

            case 'ArrowRight':
                if (this.options.flat) break;
                if (this.isOpen && this.highlightedNodeId) {
                    const node = this.flatNodes.get(this.highlightedNodeId);
                    if (node && !node.isLeaf && !node.isExpanded) {
                        this.#toggleNode(node);
                    }
                }
                e.preventDefault();
                break;

            case 'ArrowLeft':
                if (this.options.flat) break;
                if (this.isOpen && this.highlightedNodeId) {
                    const node = this.flatNodes.get(this.highlightedNodeId);
                    if (node && !node.isLeaf && node.isExpanded) {
                        this.#toggleNode(node);
                    }
                }
                e.preventDefault();
                break;
        }
    }

    #highlightAllVisible() {
        if (this.searchQuery) {
            const matchedIds = [];
            for (const id of this.visibleNodes) {
                const node = this.flatNodes.get(id);
                if (node?.isMatched) matchedIds.push(id);
            }
            this.temporaryHighlightedIds = new Set(matchedIds);
        } else {
            this.temporaryHighlightedIds = new Set(this.visibleNodes);
        }

        this.highlightedNodeId = null;

        const existing = this.treeContainer.querySelectorAll('.is-highlighted');
        for (let i = 0, len = existing.length; i < len; i++) {
            existing[i].classList.remove('is-highlighted');
        }

        for (const id of this.temporaryHighlightedIds) {
            const el = this.#nodeElementMap.get(id);
            if (el) el.classList.add('is-highlighted');
        }
    }

    #clearTemporaryHighlights() {
        for (const id of this.temporaryHighlightedIds) {
            const el = this.#nodeElementMap.get(id);
            if (el) el.classList.remove('is-highlighted');
        }
        this.temporaryHighlightedIds.clear();
    }

    #selectTemporaryHighlighted() {
        const nodesToProcess = [];

        for (const id of this.temporaryHighlightedIds) {
            const node = this.flatNodes.get(id);
            if (node && !node.disabled) {
                nodesToProcess.push(node);
            }
        }

        if (nodesToProcess.length === 0) {
            this.#clearTemporaryHighlights();
            return;
        }

        const shouldDeselect = nodesToProcess.every(node => this.selectedValues.has(node.id));
        let changed = false;

        for (const node of nodesToProcess) {
            if (shouldDeselect) {
                if (this.selectedValues.has(node.id)) {
                    this.#deselectNode(node);
                    changed = true;
                }
            } else {
                if (!this.selectedValues.has(node.id)) {
                    this.#doSelectNode(node);
                    changed = true;
                }
            }
        }

        if (changed) {
            this.#updateDisplay();
            this.#updateNodeStates();
            this.#emit('change', this.getValue());
        }

        this.#clearTemporaryHighlights();
    }

    #highlightNext() {
        const currentIndex = this.visibleNodes.indexOf(this.highlightedNodeId);
        const nextIndex = currentIndex < this.visibleNodes.length - 1 ? currentIndex + 1 : 0;
        this.#highlight(this.visibleNodes[nextIndex]);
    }

    #highlightPrev() {
        const currentIndex = this.visibleNodes.indexOf(this.highlightedNodeId);

        if (currentIndex <= 0) {
            if (this.highlightedNodeId) {
                const oldEl = this.#nodeElementMap.get(this.highlightedNodeId);
                if (oldEl) oldEl.classList.remove('is-highlighted');
                this.highlightedNodeId = null;
            }
            return;
        }

        this.#highlight(this.visibleNodes[currentIndex - 1]);
    }

    #highlight(nodeId) {
        if (this.highlightedNodeId) {
            const oldEl = this.#nodeElementMap.get(this.highlightedNodeId);
            if (oldEl) oldEl.classList.remove('is-highlighted');
        }

        this.highlightedNodeId = nodeId;
        const newEl = this.#nodeElementMap.get(nodeId);

        const node = this.flatNodes.get(nodeId);
        if (node && !node.isLeaf && !node.isExpanded) {
            this.#toggleNode(node);
        }

        if (newEl) {
            newEl.classList.add('is-highlighted');
            newEl.scrollIntoView({ block: 'nearest', behavior: TreeSelect.CONSTANTS.SCROLL_BEHAVIOR });
        }
    }

    #toggleNode(node) {
        node.isExpanded = !node.isExpanded;
        const nodeEl = this.#nodeElementMap.get(node.id);
        if (nodeEl) {
            nodeEl.classList.toggle('is-expanded', node.isExpanded);
        }
        this.#updateVisibleNodes();
    }

    #updateVisibleNodes() {
        this.visibleNodes.length = 0;
        const rootNodes = [];
        for (const node of this.flatNodes.values()) {
            if (node.parent === null) rootNodes.push(node);
        }
        this.#collectVisibleNodes(rootNodes);
    }

    #collectVisibleNodes(nodes) {
        for (const node of nodes) {
            if (node.isVisible || !this.searchQuery) {
                this.visibleNodes.push(node.id);

                if (!node.isLeaf && node.isExpanded) {
                    const children = [];
                    for (const id of node.children) {
                        const child = this.flatNodes.get(id);
                        if (child) children.push(child);
                    }
                    this.#collectVisibleNodes(children);
                }
            }
        }
    }

    #selectNode(node) {
        if (node.disabled) return;

        if (this.options.multiple) {
            if (this.selectedValues.has(node.id)) {
                this.#deselectNode(node);
            } else {
                this.#doSelectNode(node);
            }
        } else {
            this.selectedValues.clear();
            this.selectedValues.set(node.id, node);

            if (this.options.closeOnSelect) {
                this.close();
            }
        }

        this.#updateDisplay();
        this.#updateNodeStates();
        this.#emit('change', this.getValue());
    }

    #doSelectNode(node) {
        this.selectedValues.set(node.id, node);

        if (this.options.autoSelectDescendants && !node.isLeaf) {
            this.#selectDescendants(node);
        }

        this.#updateAncestorStates(node);
    }

    #deselectNode(node) {
        this.selectedValues.delete(node.id);

        if (this.options.autoDeselectDescendants && !node.isLeaf) {
            this.#deselectDescendants(node);
        }

        this.#updateAncestorStates(node);
    }

    #selectDescendants(node) {
        if (node.isLeaf) return;

        for (const childId of node.children) {
            const child = this.flatNodes.get(childId);
            if (child && !child.disabled) {
                this.selectedValues.set(child.id, child);
                this.#selectDescendants(child);
            }
        }
    }

    #deselectDescendants(node) {
        if (node.isLeaf) return;

        for (const childId of node.children) {
            const child = this.flatNodes.get(childId);
            if (child) {
                this.selectedValues.delete(child.id);
                this.#deselectDescendants(child);
            }
        }
    }

    #updateAncestorStates(node) {
        if (node.parent === null) return;

        const parent = this.flatNodes.get(node.parent);
        if (!parent) return;

        let allSelected = true;
        for (const id of parent.children) {
            const child = this.flatNodes.get(id);
            if (child && !child.disabled && !this.selectedValues.has(id)) {
                allSelected = false;
                break;
            }
        }

        if (allSelected) {
            this.selectedValues.set(parent.id, parent);
        } else {
            this.selectedValues.delete(parent.id);
        }

        this.#updateAncestorStates(parent);
    }

    #isIndeterminate(node) {
        if (node.isLeaf || !this.options.multiple) return false;

        const hasSelectedDescendant = this.#hasSelectedDescendant(node);
        const allDescendantsSelected = this.#allDescendantsSelected(node);

        return hasSelectedDescendant && !allDescendantsSelected;
    }

    #hasSelectedDescendant(node) {
        for (const childId of node.children) {
            const child = this.flatNodes.get(childId);
            if (!child) continue;
            if (this.selectedValues.has(childId)) return true;
            if (this.#hasSelectedDescendant(child)) return true;
        }
        return false;
    }

    #allDescendantsSelected(node) {
        for (const childId of node.children) {
            const child = this.flatNodes.get(childId);
            if (!child) continue;
            if (child.disabled) continue;
            if (!this.selectedValues.has(childId)) return false;
            if (!child.isLeaf && !this.#allDescendantsSelected(child)) return false;
        }
        return true;
    }

    #updateNodeStates() {
        for (const [id, node] of this.flatNodes) {
            const nodeEl = this.#nodeElementMap.get(id);
            if (!nodeEl) continue;

            nodeEl.classList.toggle('is-selected', this.selectedValues.has(id));

            if (this.options.multiple) {
                nodeEl.classList.toggle('is-indeterminate', this.#isIndeterminate(node));
            }
        }
    }

    #updateDisplay() {
        this.valueContainer.innerHTML = '';

        if (this.selectedValues.size === 0) {
            const placeholder = document.createElement('span');
            placeholder.className = 'treeselect-placeholder';
            placeholder.textContent = this.options.placeholder;
            this.valueContainer.appendChild(placeholder);

            if (this.clearBtn) {
                this.clearBtn.style.display = 'none';
            }
        } else if (!this.options.multiple) {
            const selectedNode = this.selectedValues.values().next().value;
            const value = document.createElement('span');
            value.className = 'treeselect-single-value';
            value.textContent = selectedNode.label;
            this.valueContainer.appendChild(value);

            if (this.clearBtn) {
                this.clearBtn.style.display = 'flex';
            }
        } else {
            const values = Array.from(this.selectedValues.values());
            const displayValues = this.#getDisplayValues(values);
            const maxTags = TreeSelect.CONSTANTS.MAX_VISIBLE_TAGS;

            const len = Math.min(displayValues.length, maxTags);
            for (let i = 0; i < len; i++) {
                const tag = this.#createTag(displayValues[i]);
                this.valueContainer.appendChild(tag);
            }

            if (displayValues.length > maxTags) {
                const count = document.createElement('span');
                count.className = 'treeselect-tag-count';
                count.textContent = `+${displayValues.length - maxTags}`;
                this.valueContainer.appendChild(count);
            }

            if (this.clearBtn) {
                this.clearBtn.style.display = 'flex';
            }
        }
    }

    #getDisplayValues(values) {
        switch (this.options.valueConsistsOf) {
            case 'LEAF':
                return values.filter(v => v.isLeaf);

            case 'BRANCH_PRIORITY':
                return values.filter(v => {
                    if (v.parent === null) return true;
                    const parent = this.flatNodes.get(v.parent);
                    return !parent || !this.selectedValues.has(parent.id);
                });

            case 'ALL':
            default:
                return values;
        }
    }

    #createTag(node) {
        const tag = document.createElement('span');
        tag.className = 'treeselect-tag';

        const label = document.createElement('span');
        label.className = 'treeselect-tag-label';
        label.textContent = node.label;
        label.title = node.label;
        tag.appendChild(label);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'treeselect-tag-remove';
        removeBtn.innerHTML = '<i class="bi bi-x"></i>';
        removeBtn.setAttribute('aria-label', `Remove ${node.label}`);
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.#deselectNode(node);
            this.#updateDisplay();
            this.#updateNodeStates();
            this.#emit('change', this.getValue());
        });
        tag.appendChild(removeBtn);

        return tag;
    }

    #search(query) {
        this.searchQuery = query.toLowerCase().trim();
        this.#clearTemporaryHighlights();

        for (const node of this.flatNodes.values()) {
            node.isVisible = false;
            node.isMatched = false;
        }

        if (!this.searchQuery) {
            for (const node of this.flatNodes.values()) {
                node.isVisible = true;
            }
        } else {
            for (const node of this.flatNodes.values()) {
                if (this.#matchesSearch(node.label, this.searchQuery)) {
                    node.isMatched = true;
                    node.isVisible = true;
                    this.#makeAncestorsVisible(node);
                }
            }
        }

        this.#renderTree();
        this.#emit('search', this.searchQuery);
    }

    #matchesSearch(text, query) {
        const lowerText = text.toLowerCase();

        if (lowerText.includes(query)) {
            return true;
        }

        let queryIndex = 0;
        for (let i = 0, len = lowerText.length; i < len && queryIndex < query.length; i++) {
            if (lowerText[i] === query[queryIndex]) {
                queryIndex++;
            }
        }
        return queryIndex === query.length;
    }

    #makeAncestorsVisible(node) {
        if (node.parent === null) return;

        const parent = this.flatNodes.get(node.parent);
        if (parent) {
            parent.isVisible = true;
            parent.isExpanded = true;
            this.#makeAncestorsVisible(parent);
        }
    }

    // Fixed Position Helpers

    /**
     * Update menu position for fixed positioning mode
     * Calculates position based on control's viewport position
     */
    #updateMenuPosition() {
        if (!this.options.useFixedPosition || !this.control || !this.menu) return;

        const rect = this.control.getBoundingClientRect();
        const menuHeight = this.menu.offsetHeight || 300;
        const viewportHeight = window.innerHeight;

        // Check if there's enough space below, otherwise position above
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        const showAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;

        this.menu.style.position = 'fixed';
        this.menu.style.width = `${rect.width}px`;
        this.menu.style.left = `${rect.left}px`;

        if (showAbove) {
            this.menu.style.bottom = `${viewportHeight - rect.top + 4}px`;
            this.menu.style.top = 'auto';
        } else {
            this.menu.style.top = `${rect.bottom + 4}px`;
            this.menu.style.bottom = 'auto';
        }
    }

    /**
     * Find all scrollable parent elements
     * @returns {Element[]} Array of scrollable parents
     */
    #getScrollParents() {
        const parents = [];
        let el = this.container.parentElement;

        while (el) {
            const style = getComputedStyle(el);
            const overflow = style.overflow + style.overflowY;
            if (/(auto|scroll)/.test(overflow)) {
                parents.push(el);
            }
            el = el.parentElement;
        }

        return parents;
    }

    /**
     * Add scroll and resize listeners for fixed positioning
     */
    #addPositionListeners() {
        if (!this.options.useFixedPosition) return;

        // Find and store scroll parents
        this.#scrollParents = this.#getScrollParents();

        // Add scroll listeners to all scrollable parents
        for (const parent of this.#scrollParents) {
            parent.addEventListener('scroll', this.#boundUpdateMenuPosition, { passive: true });
        }

        // Also listen to window scroll and resize
        window.addEventListener('scroll', this.#boundUpdateMenuPosition, { passive: true });
        window.addEventListener('resize', this.#boundUpdateMenuPosition, { passive: true });
    }

    /**
     * Remove scroll and resize listeners
     */
    #removePositionListeners() {
        if (!this.options.useFixedPosition) return;

        // Remove scroll listeners from all scroll parents
        for (const parent of this.#scrollParents) {
            parent.removeEventListener('scroll', this.#boundUpdateMenuPosition);
        }
        this.#scrollParents = [];

        // Remove window listeners
        window.removeEventListener('scroll', this.#boundUpdateMenuPosition);
        window.removeEventListener('resize', this.#boundUpdateMenuPosition);
    }

    #emit(event, data) {
        const callbacks = this.callbacks[event];
        if (callbacks) {
            for (const cb of callbacks) {
                try {
                    cb(data);
                } catch (error) {
                    console.error(`TreeSelect: Error in ${event} callback`, error);
                }
            }
        }
    }

    // Public API

    /**
     * Open the dropdown menu
     */
    open() {
        if (this.isDisabled || this.isOpen) return;

        this.isOpen = true;
        this.container.classList.add('is-open');
        this.menu.classList.add('is-open');
        this.control.setAttribute('aria-expanded', 'true');

        // Update position for fixed positioning mode
        if (this.options.useFixedPosition) {
            this.#updateMenuPosition();
            this.#addPositionListeners();
        }

        if (this.searchInput) {
            setTimeout(() => this.searchInput.focus(), TreeSelect.CONSTANTS.ANIMATION_DELAY_MS);
        }

        this.#emit('open');
    }

    /**
     * Close the dropdown menu
     */
    close() {
        if (!this.isOpen) return;

        this.isOpen = false;
        this.container.classList.remove('is-open');
        this.menu.classList.remove('is-open');
        this.control.setAttribute('aria-expanded', 'false');

        // Remove position listeners for fixed positioning mode
        if (this.options.useFixedPosition) {
            this.#removePositionListeners();
        }

        if (this.searchInput) {
            this.searchInput.value = '';
            this.#search('');
        }

        this.#clearTemporaryHighlights();
        this.#emit('close');
    }

    /**
     * Toggle the dropdown open/closed
     */
    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    /**
     * Clear all selections
     */
    clear() {
        this.selectedValues.clear();
        this.#updateDisplay();
        this.#updateNodeStates();
        this.#emit('change', this.getValue());
    }

    /**
     * Get selected value(s)
     * @returns {*} Single value for single-select, array for multi-select
     */
    getValue() {
        const values = Array.from(this.selectedValues.values());
        const displayValues = this.#getDisplayValues(values);

        if (!this.options.multiple) {
            return displayValues.length > 0 ? displayValues[0].id : null;
        }

        return displayValues.map(v => v.id);
    }

    /**
     * Set selected value(s) programmatically
     * @param {*} values - Single value or array of values
     */
    setValue(values) {
        this.selectedValues.clear();

        const valuesArray = Array.isArray(values) ? values : [values];

        for (const id of valuesArray) {
            const node = this.flatNodes.get(id);
            if (node && !node.disabled) {
                this.selectedValues.set(id, node);
            } else if (node === undefined) {
                console.warn(`TreeSelect: Node with id "${id}" not found`);
            }
        }

        this.#updateDisplay();
        this.#updateNodeStates();
    }

    /**
     * Register an event callback
     * @param {string} event - Event name (change, open, close, search)
     * @param {Function} callback - Callback function
     * @returns {TreeSelect} For chaining
     */
    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        } else {
            console.warn(`TreeSelect: Unknown event "${event}"`);
        }
        return this;
    }

    /**
     * Remove an event callback
     * @param {string} event - Event name
     * @param {Function} callback - Callback function to remove
     * @returns {TreeSelect} For chaining
     */
    off(event, callback) {
        if (this.callbacks[event]) {
            const index = this.callbacks[event].indexOf(callback);
            if (index > -1) {
                this.callbacks[event].splice(index, 1);
            }
        }
        return this;
    }

    /**
     * Enable the dropdown
     */
    enable() {
        this.isDisabled = false;
        this.container.classList.remove('is-disabled');
        this.control.tabIndex = 0;
    }

    /**
     * Disable the dropdown
     */
    disable() {
        this.isDisabled = true;
        this.container.classList.add('is-disabled');
        this.control.tabIndex = -1;
        this.close();
    }

    /**
     * Replace the data and re-render
     * @param {Array} data - New data array
     */
    setData(data) {
        if (!Array.isArray(data)) {
            throw new Error('TreeSelect: Data must be an array');
        }

        this.flatNodes.clear();
        this.selectedValues.clear();
        this.#nodeElementMap.clear();
        this.#processData(data);
        this.#renderTree();
        this.#updateDisplay();
    }
}

// Default export for convenience
export default TreeSelect;
