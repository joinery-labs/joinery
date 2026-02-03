/**
 * Save Result to Table
 * Allows saving current result set to a new database table.
 * Uses Arrow IPC streaming for bulk insertion.
 */

import { Modal } from 'bootstrap';
import { tableToIPC } from 'apache-arrow';

import { getConn } from '../../core/database.js';
import { emit, Events } from '../../core/event-bus.js';
import { getSchemaList } from '../../core/schema-cache.js';
import { notify, startNotification, NOTIFICATION_TIMING } from '../../ui/notification-panel.js';
import { ensureModal } from '../../ui/templates.js';
import { getResult } from './result-state.js';
import { $ } from '../../utils/dom.js';
import { quoteIdent } from '../../utils/sql.js';
import { TreeSelect } from '../../ui/treeselect.js';

// ============================================================================
// MODULE STATE - TreeSelect Instance Management
// ============================================================================

/**
 * TreeSelect instance for schema dropdown
 * @type {TreeSelect|null}
 */
let schemaSelectInstance = null;

/**
 * Flag to track if modal cleanup listener is attached
 */
let cleanupListenerAttached = false;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Open the Save Result modal
 * @param {string} rid - Result ID
 */
export async function openSaveResultModal(rid) {
    const res = getResult(rid);
    if (!res) {
        notify("Save", "Result no longer exists", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        return;
    }

    const schemas = await getSchemaList();
    const modalEl = ensureModal('saveResultModal');

    if (!cleanupListenerAttached) {
        modalEl.addEventListener('hidden.bs.modal', destroySaveModalSelects);
        cleanupListenerAttached = true;
    }

    const body = $("#saveResultBody");
    body.innerHTML = buildModalHTML();
    initializeSaveModalSelects(schemas);

    $("#saveResultConfirmBtn").onclick = () => executeSave(rid, res);

    const modal = new Modal(modalEl, { focus: false });
    modal.show();
}

// ============================================================================
// TREESELECT MANAGEMENT
// ============================================================================

/**
 * Initialize TreeSelect instance for schema dropdown
 * @param {Array<string>} schemas - Available schema names
 */
function initializeSaveModalSelects(schemas) {
    // Clean up any existing instances first
    destroySaveModalSelects();

    // Initialize schema TreeSelect
    const schemaContainer = document.getElementById('saveResultSchemaContainer');
    if (schemaContainer) {
        const schemaData = schemas.map(s => ({ id: s, label: s }));

        schemaSelectInstance = new TreeSelect(schemaContainer, {
            data: schemaData,
            multiple: false,
            flat: true,
            searchable: true,
            placeholder: 'Select schema...',
            closeOnSelect: true,
            clearable: false,
            useFixedPosition: true
        });

        // Pre-select 'main' if available
        if (schemas.includes('main')) {
            schemaSelectInstance.setValue('main');
        } else if (schemas.length > 0) {
            schemaSelectInstance.setValue(schemas[0]);
        }
    }
}

/**
 * Destroy TreeSelect instance to prevent memory leaks
 * Called when modal is closed
 */
function destroySaveModalSelects() {
    if (schemaSelectInstance) {
        try {
            schemaSelectInstance.destroy();
        } catch (e) {
            // Ignore destruction errors
        }
        schemaSelectInstance = null;
    }
}

/**
 * Get selected schema value from TreeSelect
 * @returns {string|null} Selected schema name
 */
function getSelectedSchema() {
    if (schemaSelectInstance) {
        return schemaSelectInstance.getValue();
    }
    return null;
}

// ============================================================================
// INTERNAL LOGIC
// ============================================================================

/**
 * Build modal HTML with schema selector and table name input
 * @returns {string} HTML content
 */
function buildModalHTML() {
    return `
        <div class="mb-3">
            <div class="row g-2">
                <div class="col-md-4">
                    <label class="form-label label-base">Schema</label>
                    <div id="saveResultSchemaContainer"></div>
                </div>
                <div class="col-md-8">
                    <label for="saveResultTable" class="form-label label-base">Table Name</label>
                    <input type="text" class="form-control form-control-base" id="saveResultTable" placeholder="my_table">
                </div>
            </div>
        </div>
    `;
}

/**
 * Execute the save operation using Arrow IPC streaming.
 * Uses insertArrowFromIPCStream for bulk insertion.
 * 
 * @param {string} rid - Result ID
 * @param {object} res - Result object containing arrowTable
 */
async function executeSave(rid, res) {
    const schema = getSelectedSchema();
    const tableName = $("#saveResultTable").value.trim();

    if (!schema) {
        notify("Save", "Please select a schema", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        return;
    }

    if (!tableName) {
        notify("Save", "Please enter a table name", { variant: "warning", delay: NOTIFICATION_TIMING.WARNING });
        return;
    }

    // Construct qualified name
    const qualName = `${quoteIdent(schema)}.${quoteIdent(tableName)}`;

    const op = startNotification({
        title: 'Saving Result',
        status: 'Preparing data...'
    });
    const conn = getConn();

    try {
        if (!res.arrowTable) {
            throw new Error("No data to save");
        }

        // Arrow IPC streaming insertion - orders of magnitude faster than row-by-row INSERT
        const rowCount = await saveArrowTable(conn, res.arrowTable, qualName, op);

        // Emit schema:changed event with schemaName to refresh table dropdown
        emit(Events.SCHEMA_CHANGED, { schemaName: schema });

        // Hide modal
        const modalEl = ensureModal('saveResultModal');
        const modal = Modal.getInstance(modalEl);
        if (modal) modal.hide();

        op.end({ success: true, message: `Saved ${rowCount} rows to ${qualName}`, dismissDelay: NOTIFICATION_TIMING.SUCCESS });
    } catch (err) {
        console.error("Save failed:", err);
        op.end({ success: false, message: 'Save failed', dismissDelay: NOTIFICATION_TIMING.ERROR, details: [err.message] });
    }
}

/**
 * Save Arrow table using IPC streaming.
 * Serializes the Arrow table to IPC format and uses DuckDB's native Arrow ingestion.
 * 
 * @param {object} conn - DuckDB connection
 * @param {object} arrowTable - Apache Arrow table
 * @param {string} qualName - Qualified table name (schema.table)
 * @param {object} op - Notification operation for status updates
 * @returns {Promise<number>} Number of rows saved
 */
async function saveArrowTable(conn, arrowTable, qualName, op) {
    const numRows = arrowTable.numRows;

    op.update({ status: `Serializing ${numRows.toLocaleString()} rows...` });

    // Serialize Arrow table to IPC stream format
    // Using 'stream' format for optimal memory efficiency with large datasets
    const ipcBuffer = tableToIPC(arrowTable, 'stream');

    op.update({ status: 'Inserting into database...' });

    // Use a temporary name for insertion, then rename to target
    // This ensures atomicity and allows proper schema.table qualification
    const tempName = `_arrow_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
        // Insert Arrow data into temporary table
        await conn.insertArrowFromIPCStream(ipcBuffer, { name: tempName });

        // Move to final destination with proper schema qualification
        await conn.query(`CREATE TABLE ${qualName} AS SELECT * FROM ${quoteIdent(tempName)};`);

        // Clean up temporary table
        await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(tempName)};`);
    } catch (err) {
        // Ensure cleanup on error
        try {
            await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(tempName)};`);
        } catch {
            // Ignore cleanup errors
        }
        throw err;
    }

    return numRows;
}

