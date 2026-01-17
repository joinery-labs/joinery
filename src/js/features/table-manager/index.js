/**
 * Table Manager Entry Point
 * 
 * Orchestrates the table management UI, wiring together schema/table selection,
 * viewers, and actions.
 */

import { $ } from '../../utils/dom.js';
import { on, Events } from '../../core/event-bus.js';

import {
    getCurrentSchema,
    setCurrentSchema,
    getLastSelectedTable,
    setLastSelectedTable
} from './table-state.js';
import {
    fetchAllTables,
    fetchAllSchemas,
    populateSchemaDropdown,
    populateTableDropdown,
    updateVisibility,
    initSchemaTableTreeSelects
} from './dropdown-manager.js';
import { showTableSchema } from './schema-viewer.js';

// ============================================================================
// OVERLAY HELPERS
// ============================================================================

/**
 * Controls the loading overlay for the tables card.
 * 
 * @param {'schema'|'table'|'none'} mode - The active loading state:
 *   - 'schema': Covers tables dropdown + schema view.
 *   - 'table': Covers only the schema view.
 *   - 'none': Hides all overlays.
 * @param {string} [message] - Optional text to display in the overlay.
 */
function setTablesCardOverlay(mode, message = '') {
    const tablesCardOverlay = $('#tablesCardOverlay');
    const tableSchemaOverlay = $('#tableSchemaOverlay');

    if (mode === 'schema') {
        tablesCardOverlay?.classList.add('is-active');
        tableSchemaOverlay?.classList.remove('is-active');
        const textEl = tablesCardOverlay?.querySelector('.loading-overlay-text');
        if (textEl) textEl.textContent = message;
    } else if (mode === 'table') {
        tablesCardOverlay?.classList.remove('is-active');
        tableSchemaOverlay?.classList.add('is-active');
        const textEl = tableSchemaOverlay?.querySelector('.loading-overlay-text');
        if (textEl) textEl.textContent = message;
    } else {
        tablesCardOverlay?.classList.remove('is-active');
        tableSchemaOverlay?.classList.remove('is-active');
    }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Refresh table dropdown when schema changes
on(Events.SCHEMA_CHANGED, (data) => {
    updateTableDropdown(data?.schemaName || null);
});

// Refresh table dropdown when database is switched
on(Events.DATABASE_SWITCHED, () => {
    updateTableDropdown();
});

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Refreshes the table dropdown and associated UI based on the current system state.
 * Fetches latest schema/table lists and ensures the active selection is valid.
 * 
 * @param {string} [schemaName] - Optional target schema to forcefully switch to.
 */
export async function updateTableDropdown(schemaName = null) {
    try {
        // Fetch tables and schemas in parallel for efficiency
        const [allRows, dbSchemas] = await Promise.all([
            fetchAllTables(),
            fetchAllSchemas()
        ]);

        // Build schemas list: ensure "main" is first, include all DB schemas
        const schemasFromTables = new Set(allRows.map(r => r.table_schema).filter(Boolean));
        const allSchemas = new Set(dbSchemas);
        schemasFromTables.forEach(s => allSchemas.add(s));

        let schemas = Array.from(allSchemas);
        // Move "main" to front if present, otherwise add it
        schemas = schemas.filter(s => s !== "main");
        schemas.unshift("main");

        const hasAnyTables = allRows.length > 0;
        // User schemas = any schema other than "main"
        const hasUserSchemas = schemas.some(s => s !== "main");

        // Set current schema
        if (schemaName) {
            setCurrentSchema(schemaName);
        } else {
            const current = getCurrentSchema();
            if (!current || !schemas.includes(current)) {
                setCurrentSchema("main");
            }
        }

        const currentSchemaName = getCurrentSchema();

        // Populate schema dropdown
        populateSchemaDropdown(schemas, currentSchemaName);

        // Filter tables for current schema
        const rows = allRows.filter(r => r.table_schema === currentSchemaName);
        const tableNames = rows.map(r => r.table_name);
        const hasTablesInCurrentSchema = tableNames.length > 0;

        // Update UI visibility based on content state
        updateVisibility({
            hasAnyTables,
            hasUserSchemas
        });

        // Populate table dropdown and show schema (always populate, even if empty)
        if (hasTablesInCurrentSchema) {
            const previousSelection = getLastSelectedTable(currentSchemaName);
            const selected = populateTableDropdown(tableNames, previousSelection);

            if (selected) {
                setLastSelectedTable(currentSchemaName, selected);
                await showTableSchema(selected, updateTableDropdown);
            } else {
                $("#tableSchema").innerHTML = "";
                setLastSelectedTable(currentSchemaName, null);
            }
        } else {
            // No tables in current schema
            populateTableDropdown([], null);
            $("#tableSchema").innerHTML = "";
            setLastSelectedTable(currentSchemaName, null);
        }
    } catch (err) {
        console.error("Error updating table dropdown:", err);
    }
}

/**
 * Handles schema selection changes from the UI.
 * @param {string} value - The selected schema name.
 */
async function handleSchemaChange(value) {
    setTablesCardOverlay('schema', 'Loading tables...');
    try {
        setCurrentSchema(value || "main");
        await updateTableDropdown();
    } finally {
        setTablesCardOverlay('none');
    }
}

/**
 * Handles table selection changes from the UI.
 * @param {string} value - The selected table name.
 */
async function handleTableChange(value) {
    setTablesCardOverlay('table', 'Loading table info...');
    try {
        const currentSchemaName = getCurrentSchema();
        setLastSelectedTable(currentSchemaName, value);
        await showTableSchema(value, updateTableDropdown);
    } finally {
        setTablesCardOverlay('none');
    }
}

/**
 * Initializes the Table Manager module.
 * Sets up TreeSelect components and event monitoring.
 */
export function initTableManager() {
    // Initialize TreeSelect components with change handlers
    initSchemaTableTreeSelects(handleSchemaChange, handleTableChange);
}
