/**
 * Dropdown Manager
 * 
 * Manages the TreeSelect dropdowns for schema and table selection.
 * Handles population, event binding, and visibility states.
 */

import { $ } from '../../utils/dom.js';
import { TreeSelect } from '../../ui/treeselect.js';

// TreeSelect instances
let _schemaTreeSelect = null;
let _tableTreeSelect = null;

// Event callbacks
let _onSchemaChange = null;
let _onTableChange = null;

// ============================================================================
// TREESELECT INITIALIZATION
// ============================================================================

/**
 * Initializes the schema and table TreeSelect instances.
 * Should be invoked after DOM templates are rendered.
 * 
 * @param {Function} onSchemaChange - Handler for schema selection.
 * @param {Function} onTableChange - Handler for table selection.
 */
export function initSchemaTableTreeSelects(onSchemaChange, onTableChange) {
    const schemaContainer = $('#schemaTreeSelectContainer');
    const tableContainer = $('#tableTreeSelectContainer');

    _onSchemaChange = onSchemaChange;
    _onTableChange = onTableChange;

    if (schemaContainer && !_schemaTreeSelect) {
        _schemaTreeSelect = new TreeSelect(schemaContainer, {
            data: [],
            multiple: false,
            searchable: true,
            clearable: false,
            flat: true,
            closeOnSelect: true,
            placeholder: 'Select schema...',
            noOptionsText: 'No schemas available',
            useFixedPosition: true
        });

        _schemaTreeSelect.on('change', (value) => {
            if (value && _onSchemaChange) {
                _onSchemaChange(value);
            }
        });
    }

    if (tableContainer && !_tableTreeSelect) {
        _tableTreeSelect = new TreeSelect(tableContainer, {
            data: [],
            multiple: false,
            searchable: true,
            clearable: false,
            flat: true,
            closeOnSelect: true,
            placeholder: 'Select table...',
            noOptionsText: 'No tables in this schema',
            useFixedPosition: true
        });

        _tableTreeSelect.on('change', (value) => {
            if (value && _onTableChange) {
                _onTableChange(value);
            }
        });
    }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Populates the schema dropdown options.
 * @param {string[]} schemas - Available schema names.
 * @param {string} currentSchemaName - Currently selected schema.
 */
export function populateSchemaDropdown(schemas, currentSchemaName) {
    if (!_schemaTreeSelect) return;

    // Convert to TreeSelect data format
    const data = schemas.map(s => ({
        id: s,
        label: s
    }));

    _schemaTreeSelect.setData(data);

    // Set current value if valid
    if (currentSchemaName && schemas.includes(currentSchemaName)) {
        _schemaTreeSelect.setValue(currentSchemaName);
    }
}

/**
 * Populates the table dropdown options for the current schema.
 * @param {string[]} tableNames - Available table names.
 * @param {string} previousSelection - Previously selected table (to restore state).
 * @returns {string|null} The name of the selected table, or null if none.
 */
export function populateTableDropdown(tableNames, previousSelection) {
    if (!_tableTreeSelect) return null;

    if (tableNames.length === 0) {
        _tableTreeSelect.setData([]);
        return null;
    }

    // Convert to TreeSelect data format
    const data = tableNames.map(n => ({
        id: n,
        label: n
    }));

    _tableTreeSelect.setData(data);

    // Restore previous selection if valid, otherwise select first
    let selectedTable = null;
    if (previousSelection && tableNames.includes(previousSelection)) {
        _tableTreeSelect.setValue(previousSelection);
        selectedTable = previousSelection;
    } else if (tableNames.length > 0) {
        _tableTreeSelect.setValue(tableNames[0]);
        selectedTable = tableNames[0];
    }

    return selectedTable;
}

/**
 * Updates UI element visibility based on content state.
 * Toggles between "Quick Start" view and "Table Manager" view.
 * 
 * @param {Object} state - Visibility state.
 * @param {boolean} state.hasAnyTables - True if any tables exist.
 * @param {boolean} state.hasUserSchemas - True if non-default schemas exist.
 */
export function updateVisibility({ hasAnyTables, hasUserSchemas }) {
    const tableDropdownContainer = $("#tableDropdownContainer");
    const tablesCard = $("#tablesCard");
    const copySchemaCol = $("#copySchemaCol");
    const quickStartCard = $("#quickStartCard");
    const schemaContainer = $("#schemaDropdownContainer");

    // Content exists if tables or user schemas exist
    const hasContent = hasAnyTables || hasUserSchemas;

    if (hasContent) {
        // Show content cards, hide quick start
        tablesCard.style.display = "block";
        copySchemaCol.style.display = "block";
        quickStartCard.style.display = "none";

        // Always show schema dropdown when content exists
        if (schemaContainer) schemaContainer.style.display = "block";

        // Show table dropdown
        tableDropdownContainer.style.display = "block";
    } else {
        // No content - show quick start, hide content cards
        tableDropdownContainer.style.display = "none";
        if (schemaContainer) schemaContainer.style.display = "none";
        $("#tableSchema").innerHTML = "";
        tablesCard.style.display = "none";
        copySchemaCol.style.display = "none";
        quickStartCard.style.display = "block";
    }
}
