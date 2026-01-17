/**
 * Modal Handlers
 * 
 * Controls the display and behavior of the Save and Manage Query modals.
 * specialized to handle potential query splitting and parameter detection during the save process.
 */

import { Modal } from 'bootstrap';

import { escapeHTML, $, $$ } from '../../utils/dom.js';
import { notify, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { ensureModal } from '../../ui/templates.js';
import { splitSQLStatements, canonicalizeStatement } from '../../utils/sql.js';
import {
    validateParameters,
    buildParametersFromSql
} from '../../utils/parameters.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Displays the modal for saving queries, potentially splitting them into multiple entries.
 * @param {string} rawSql - The raw SQL content from the editor.
 * @param {function} onSave - Callback executed upon successful save: (queries, splitMode) => void.
 */
export function showSaveQueriesModal(rawSql, onSave) {
    if (!rawSql.trim()) {
        notify("Save", "Nothing to save", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        return;
    }

    const statements = splitSQLStatements(rawSql);
    const canonStmts = statements
        .map(s => canonicalizeStatement(s))
        .filter(Boolean);

    if (!canonStmts.length) {
        notify("Save", "No valid statements to save", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        return;
    }

    // Ensure modal exists before accessing its elements
    const modalEl = ensureModal('nameQueriesModal');
    if (!modalEl) return;

    const tbody = $("#nameQueriesBody");
    const toggleWrap = $("#splitQueriesToggleWrap");

    // Show split toggle
    if (toggleWrap) toggleWrap.style.display = "";

    // Clone the toggle element to clear any event listeners attached from previous modal interactions
    let splitToggle = $("#splitQueriesChk");
    if (splitToggle) {
        const newToggle = splitToggle.cloneNode(true);
        splitToggle.parentNode.replaceChild(newToggle, splitToggle);
        splitToggle = newToggle;
        splitToggle.checked = true;
    }

    // Render rows function
    const renderRows = (split) => {
        tbody.innerHTML = "";

        if (split) {
            // Split mode: Render one row for each validated statement
            canonStmts.forEach((stmt, idx) => {
                const params = buildParametersFromSql(stmt, []);
                const row = createQueryRow(stmt, idx, stmt.slice(0, 50), params);
                tbody.appendChild(row);
            });
        } else {
            // Single mode: Render one row containing the entire SQL block
            const params = buildParametersFromSql(rawSql, []);
            const row = createQueryRow(rawSql, 0, rawSql.slice(0, 50), params);
            tbody.appendChild(row);
        }

        // Wire up event handlers
        wireRemoveButtons(tbody);
        wireParameterUpdates(tbody);
    };

    // Initial render
    renderRows(true);

    // Toggle event - listener is fresh since element was cloned
    splitToggle?.addEventListener("change", () => {
        renderRows(splitToggle.checked);
    });

    // Show modal
    const modal = new Modal(modalEl);
    modal.show();

    // Save button handler
    $("#saveQueriesBtn").onclick = () => {
        const rows = $$("tr", tbody);
        const queries = [];
        const errors = [];

        for (const row of rows) {
            const queryInput = $(".query-text", row);
            const nameInput = $(".query-name", row);

            const sql = queryInput.value.trim();
            const name = nameInput.value.trim();

            // Validation
            if (!sql) {
                errors.push("Query cannot be empty");
                queryInput.classList.add("is-invalid");
                continue;
            } else {
                queryInput.classList.remove("is-invalid");
            }

            if (!name) {
                errors.push("All queries must have a name");
                nameInput.classList.add("is-invalid");
                continue;
            } else {
                nameInput.classList.remove("is-invalid");
            }

            // Collect parameters from this row
            const parameters = collectParametersFromRow(row);

            // Validate parameters
            const validation = validateParameters(parameters);
            if (!validation.valid) {
                errors.push(validation.error);
                continue;
            }

            // Collect folder from this row
            const folderInput = $(".query-folder", row);
            const folder = folderInput ? (folderInput.value.trim() || '/') : '/';

            queries.push({ sql, name, parameters, folder });
        }

        if (errors.length > 0) {
            notify("Validation", errors[0], { variant: "danger", delay: NOTIFICATION_TIMING.ERROR });
            return;
        }

        if (queries.length === 0) {
            notify("Save", "Nothing to save", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
            return;
        }

        const splitEnabled = $("#splitQueriesChk")?.checked !== false;

        if (onSave) {
            onSave(queries, splitEnabled);
        }

        // Blur active element before hiding to prevent focus trapping or aria-hidden conflicts
        if (document.activeElement) {
            document.activeElement.blur();
        }
        setTimeout(() => modal.hide(), 10);
    };
}

/**
 * Show manage queries modal
 * @param {Array} items - Existing saved queries
 * @param {function} onSave - Callback when queries are updated: (updatedItems) => void
 */
export function showManageQueriesModal(items, onSave) {
    if (!items.length) {
        notify("Manage", "No saved queries to manage", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        return;
    }

    // Ensure modal exists before accessing its elements
    const modalEl = ensureModal('nameQueriesModal');
    if (!modalEl) return;

    const tbody = $("#nameQueriesBody");
    const toggleWrap = $("#splitQueriesToggleWrap");

    // Hide split toggle in manage mode
    if (toggleWrap) toggleWrap.style.display = "none";

    tbody.innerHTML = "";

    items.forEach((item, idx) => {
        const params = item.parameters || buildParametersFromSql(item.sql, []);
        const folder = item.folder || '/';
        const row = createQueryRow(item.sql, idx, item.name || item.title || '', params, item.id, folder);
        tbody.appendChild(row);
    });

    // Wire up event handlers
    wireManageRemoveButtons(tbody, items);
    wireParameterUpdates(tbody);

    // Show modal
    const modal = new Modal(modalEl);
    $("#nameQueriesModal .modal-title").innerHTML = '<i class="bi bi-bookmark-star me-2"></i>Manage Saved Queries';
    modal.show();

    // Save button handler
    $("#saveQueriesBtn").onclick = () => {
        const rows = $$("tr", tbody);
        const updatedItems = [];
        const errors = [];

        for (const row of rows) {
            const queryInput = $(".query-text", row);
            const nameInput = $(".query-name", row);
            const idx = parseInt(nameInput.getAttribute("data-idx"), 10);
            const queryId = row.getAttribute("data-query-id");

            const sql = queryInput.value.trim();
            const name = nameInput.value.trim();

            // Validation
            if (!sql) {
                errors.push("Query cannot be empty");
                queryInput.classList.add("is-invalid");
                continue;
            } else {
                queryInput.classList.remove("is-invalid");
            }

            if (!name) {
                errors.push("All queries must have a name");
                nameInput.classList.add("is-invalid");
                continue;
            } else {
                nameInput.classList.remove("is-invalid");
            }

            // Collect parameters from this row
            const parameters = collectParametersFromRow(row);

            // Validate parameters
            const validation = validateParameters(parameters);
            if (!validation.valid) {
                errors.push(validation.error);
                continue;
            }

            // Collect folder from this row
            const folderInput = $(".query-folder", row);
            const folder = folderInput ? (folderInput.value.trim() || '/') : '/';

            updatedItems.push({
                id: queryId || items[idx]?.id,
                name: name,
                sql: sql,
                parameters: parameters,
                folder: folder,
                ts: items[idx]?.ts || Date.now()
            });
        }

        if (errors.length > 0) {
            notify("Validation", errors[0], { variant: "danger", delay: NOTIFICATION_TIMING.ERROR });
            return;
        }

        if (onSave) {
            onSave(updatedItems);
        }

        // Blur active element before hiding to prevent aria-hidden focus conflict
        if (document.activeElement) {
            document.activeElement.blur();
        }
        setTimeout(() => {
            modal.hide();
            $("#nameQueriesModal .modal-title").textContent = "Name Saved Queries";
        }, 10);
    };

    // Reset title on modal close
    $("#nameQueriesModal").addEventListener("hidden.bs.modal", () => {
        $("#nameQueriesModal .modal-title").innerHTML = '<i class="bi bi-bookmark-plus me-2"></i>Name Saved Queries';
    }, { once: true });
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Helper: Creates a table row element for a query entry.
 * @param {string} sql - The SQL statement.
 * @param {number} idx - UI index for the row.
 * @param {string} name - Name of the query.
 * @param {Array} parameters - List of parameter objects {name, defaultValue}.
 * @param {string} queryId - (Optional) Persistence ID for existing queries.
 * @param {string} folder - (Optional) Virtual folder path.
 * @returns {HTMLElement} The constructed table row.
 */
function createQueryRow(sql, idx, name, parameters = [], queryId = null, folder = '/') {
    const row = document.createElement("tr");
    if (queryId) {
        row.setAttribute("data-query-id", queryId);
    }

    // Build parameters HTML - uses CSS grid for consistent layout
    const paramsHtml = parameters.length > 0
        ? parameters.map((p, pIdx) => `
            <div class="param-row" data-param-idx="${pIdx}">
                <span class="param-name" title="{{${escapeHTML(p.name)}}}">{{${escapeHTML(p.name)}}}</span>
                <input type="text" class="form-control form-control-base param-default" 
                    placeholder="default" 
                    data-param-name="${escapeHTML(p.name)}"
                    value="${escapeHTML(p.defaultValue || '')}">
            </div>
        `).join('')
        : '<span class="no-params">No parameters</span>';

    row.innerHTML = `
    <td>
      <textarea class="form-control form-control-base query-text cell-textarea" rows="5" placeholder="Enter a query..." data-idx="${idx}">${escapeHTML(sql)}</textarea>
    </td>
    <td>
      <textarea class="form-control form-control-base query-name cell-textarea" rows="5"
        placeholder="Enter a name..." 
        data-idx="${idx}">${escapeHTML(name)}</textarea>
    </td>
    <td>
      <textarea class="form-control form-control-base query-folder cell-textarea" rows="5"
        placeholder="/" 
        data-idx="${idx}">${escapeHTML(folder)}</textarea>
    </td>
    <td class="params-cell">
      <div class="params-container">
        ${paramsHtml}
      </div>
    </td>
    <td class="action-cell">
      <button class="btn btn-base danger remove-query-row" data-idx="${idx}" title="Remove">
        <i class="bi bi-trash"></i>&nbsp;Remove
      </button>
    </td>
  `;
    return row;
}

/**
 * Collect parameters from a row
 * @param {HTMLElement} row - Table row element
 * @returns {Array<{name: string, defaultValue: string}>}
 */
function collectParametersFromRow(row) {
    const paramInputs = $$(".param-default", row);
    const parameters = [];

    for (const input of paramInputs) {
        const paramName = input.getAttribute("data-param-name");
        if (paramName) {
            parameters.push({
                name: paramName,
                defaultValue: input.value || ''
            });
        }
    }

    return parameters;
}

/**
 * Update parameters display when SQL changes
 * @param {HTMLElement} row - Table row element
 */
function updateParametersForRow(row) {
    const queryInput = $(".query-text", row);
    const paramsContainer = $(".params-container", row);

    if (!queryInput || !paramsContainer) return;

    const sql = queryInput.value;

    // Get existing parameter defaults
    const existingParams = collectParametersFromRow(row);

    // Build new parameters from SQL
    const newParams = buildParametersFromSql(sql, existingParams);

    // Render updated parameters - uses CSS grid for consistent layout
    if (newParams.length > 0) {
        paramsContainer.innerHTML = newParams.map((p, pIdx) => `
            <div class="param-row" data-param-idx="${pIdx}">
                <span class="param-name" title="{{${escapeHTML(p.name)}}}">{{${escapeHTML(p.name)}}}</span>
                <input type="text" class="form-control form-control-base param-default" 
                    placeholder="default" 
                    data-param-name="${escapeHTML(p.name)}"
                    value="${escapeHTML(p.defaultValue || '')}">
            </div>
        `).join('');
    } else {
        paramsContainer.innerHTML = '<span class="no-params">No parameters</span>';
    }
}

/**
 * Wire up parameter update handlers for SQL textarea changes
 * @param {HTMLElement} tbody - Table body element
 */
function wireParameterUpdates(tbody) {
    $$(".query-text", tbody).forEach(textarea => {
        // Debounce updates
        let timeout = null;
        textarea.addEventListener("input", () => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                const row = textarea.closest("tr");
                updateParametersForRow(row);
            }, 300);
        });
    });
}

/**
 * Wire up remove button event handlers for save modal
 * @param {HTMLElement} tbody - Table body element
 */
function wireRemoveButtons(tbody) {
    $$(".remove-query-row", tbody).forEach(btn => {
        btn.addEventListener("click", (e) => {
            const row = e.target.closest("tr");
            row.remove();

            if (tbody.children.length === 0) {
                notify("Save", "No queries to save", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
                const modalEl = ensureModal('nameQueriesModal');
                const modalInstance = Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();
            }
        });
    });
}

/**
 * Wire up remove button event handlers for manage modal
 * @param {HTMLElement} tbody - Table body element
 * @param {Array} items - Original items array
 */
function wireManageRemoveButtons(tbody, items) {
    $$(".remove-query-row", tbody).forEach(btn => {
        btn.addEventListener("click", (e) => {
            const row = e.target.closest("tr");
            row.remove();

            if (tbody.children.length === 0) {
                notify("Manage", "All queries removed", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
            }
        });
    });
}
