/**
 * Schema Editor
 * 
 * Manages the modal interface for modifying table column types.
 * Utilizes TreeSelect for data type selection.
 */

import { Modal } from 'bootstrap';

import { getConn } from '../../core/database.js';
import { getTableColumns } from '../../core/schema-cache.js';
import { notify, startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { ensureModal } from '../../ui/templates.js';
import { escapeHTML, $ } from '../../utils/dom.js';
import { quoteIdent } from '../../utils/sql.js';
import { getCurrentSchema } from './table-state.js';
import { showTableSchema } from './schema-viewer.js';
import { TreeSelect } from '../../ui/treeselect.js';
import {
    DUCKDB_TYPES_SET,
    TYPE_SELECT_DATA,
    normalizeTypeName
} from '../../utils/types.js';

// ============================================================================
// Module State - TreeSelect Instance Management
// ============================================================================

/**
 * Map of column name -> TreeSelect instance for lifecycle management
 * @type {Map<string, TreeSelect>}
 */
const typeSelectInstances = new Map();

/**
 * Flag to track if modal cleanup listener is attached
 */
let cleanupListenerAttached = false;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Opens the Schema Editor modal for the specified table.
 * Fetches current column definitions and populates the editor.
 * 
 * @param {string} tableName - Target table name.
 */
export async function openSchemaEditor(tableName) {
    try {
        const currentSchemaName = getCurrentSchema();
        const rows = await getTableColumns(currentSchemaName, tableName);

        const modalEl = ensureModal('schemaTypeModal');
        if (!modalEl) return;

        const body = $("#schemaTypeBody");
        body.innerHTML = buildTypeEditorHTML(rows);

        if (!cleanupListenerAttached) {
            modalEl.addEventListener('hidden.bs.modal', destroyTypeSelects);
            cleanupListenerAttached = true;
        }

        initializeTypeSelects(rows);

        const modal = new Modal(modalEl, { focus: false });
        $("#schemaTypeSaveBtn").onclick = () => validateAndApplySchema(tableName);
        modal.show();
    } catch (err) {
        notify("Schema error", err.message, { variant: "danger", delay: NOTIFICATION_TIMING.ERROR });
    }
}

// ============================================================================
// PRIVATE HELPERS - TreeSelect Management
// ============================================================================

/**
 * Initialize TreeSelect instances for all type selector containers
 * @param {Array} rows - Column information from database
 */
function initializeTypeSelects(rows) {
    // Clean up any existing instances first
    destroyTypeSelects();

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const colName = row.column_name;
        const containerId = `ts-type-${i}`;
        const container = document.getElementById(containerId);

        if (!container) {
            console.warn(`TreeSelect container not found: ${containerId}`);
            continue;
        }

        // Normalize type name for consistent selection state
        const currentType = normalizeTypeName(row.data_type);

        // Create TreeSelect instance
        const treeSelect = new TreeSelect(container, {
            data: TYPE_SELECT_DATA,
            multiple: false,
            flat: true,
            searchable: true,
            placeholder: 'Select type...',
            closeOnSelect: true,
            clearable: false,
            useFixedPosition: true
        });

        if (DUCKDB_TYPES_SET.has(currentType)) {
            treeSelect.setValue(currentType);
        }

        // Map column name to instance for later retrieval
        typeSelectInstances.set(colName, treeSelect);
    }
}

/**
 * Destroys all active TreeSelect instances to free resources.
 */
function destroyTypeSelects() {
    for (const [, instance] of typeSelectInstances) {
        try {
            instance.destroy();
        } catch (e) {
            // Ignore destruction errors
        }
    }
    typeSelectInstances.clear();
}

/**
 * Retrieves the currently selected type for each column.
 * @returns {Object} Map of `column_name` -> `selected_type`.
 */
function getSelectedTypes() {
    const result = {};
    for (const [colName, instance] of typeSelectInstances) {
        const value = instance.getValue();
        if (value) {
            result[colName] = value;
        }
    }
    return result;
}

// ============================================================================
// PRIVATE HELPERS - HTML Generation
// ============================================================================

/**
 * Generates the HTML for the type editor table.
 * @param {Array} rows - Column metadata rows.
 * @returns {string} Rendered HTML string.
 */
function buildTypeEditorHTML(rows) {
    return `
        <table class="table table-base table-sm mb-0">
          <thead class="">
            <tr><th style="width:6ch">#</th><th style="width:40%">Column</th><th style="width:30%">Current</th><th style="width:30%">New type</th></tr>
          </thead>
          <tbody>
            ${rows.map((r, i) => {
        const name = r.column_name;
        return `<tr>
                        <td>${i + 1}</td>
                        <td>${escapeHTML(name)}</td>
                        <td>${escapeHTML(r.data_type || "")}</td>
                        <td>
                            <div id="ts-type-${i}" data-col="${escapeHTML(name)}"></div>
                        </td>
                      </tr>`;
    }).join("")}
          </tbody>
        </table>
    `;
}

// ============================================================================
// PRIVATE HELPERS - Schema Operations
// ============================================================================

/**
 * Validates selected types and applies changes to the database.
 * Computes a diff between current and new types to generate ALTER statements.
 * 
 * @param {string} tableName - Target table name.
 */
async function validateAndApplySchema(tableName) {
    const newTypesByCol = getSelectedTypes();

    if (Object.keys(newTypesByCol).length === 0) {
        notify("Schema", "Nothing to update", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        return;
    }

    const currentSchemaName = getCurrentSchema();
    const qualifiedName =
        currentSchemaName && currentSchemaName !== "main"
            ? `${quoteIdent(currentSchemaName)}.${quoteIdent(tableName)}`
            : quoteIdent(tableName);

    const op = startNotification({
        title: 'Updating Schema',
        status: 'Applying schema changes...'
    });
    const conn = getConn();

    try {
        const cols = await getTableColumns(currentSchemaName, tableName);
        const current = {};
        for (const col of cols) {
            current[col.column_name] = normalizeTypeName(col.data_type);
        }

        const changes = Object.entries(newTypesByCol).filter(
            ([col, tgt]) => current[col] !== tgt
        );

        if (!changes.length) {
            op.end({ success: true, message: 'No type changes to apply', dismissDelay: NOTIFICATION_TIMING.INFO });
            return;
        }

        await conn.query("BEGIN;");
        for (const [col, targetType] of changes) {
            try {
                await conn.query(`ALTER TABLE ${qualifiedName} ALTER COLUMN ${quoteIdent(col)} SET DATA TYPE ${targetType};`);
            } catch (e) {
                const err = new Error(`[${col}] ${e?.message || String(e)}`);
                err.original = e;
                throw err;
            }
        }
        await conn.query("COMMIT;");

        const modalEl = ensureModal('schemaTypeModal');
        const modal = Modal.getInstance(modalEl);
        if (modal) modal.hide();

        op.end({ success: true, message: `Updated ${changes.length} column${changes.length > 1 ? "s" : ""}`, dismissDelay: NOTIFICATION_TIMING.SUCCESS });
        await showTableSchema(tableName);
    } catch (e) {
        try {
            await conn.query("ROLLBACK;");
        } catch { }
        op.end({ success: false, message: 'Schema change failed', dismissDelay: NOTIFICATION_TIMING.ERROR, details: [e?.message || String(e)] });
    }
}
