/**
 * Schema Viewer
 * 
 * Renders the table details view, including schema definitions,
 * metadata (record count), and action controls.
 */

import { getConn } from '../../core/database.js';
import { getTableColumns } from '../../core/schema-cache.js';
import { escapeHTML, $, $$ } from '../../utils/dom.js';
import { quoteIdent, sqlStringEscape } from '../../utils/sql.js';
import { getCurrentSchema } from './table-state.js';
import { insertSelectStatement } from './query-integration.js';
import { exportTable } from './export-operations.js';
import { deleteTable } from './table-actions.js';
import { openSchemaEditor } from './schema-editor.js';
import { openRenameTableModal } from './table-rename.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Displays the schema and metadata for the specified table.
 * 
 * @param {string} tableName - Name of the table to display.
 * @param {Function} onDeleteCallback - Handler invoked if the table is deleted.
 */
export async function showTableSchema(tableName, onDeleteCallback) {
  try {
    const conn = getConn();
    const currentSchemaName = getCurrentSchema();

    const qualifiedName =
      currentSchemaName && currentSchemaName !== "main"
        ? `${quoteIdent(currentSchemaName)}.${quoteIdent(tableName)}`
        : quoteIdent(tableName);

    const [countRes, pkRes, cols] = await Promise.all([
      conn.query(`SELECT COUNT(*) as c FROM ${qualifiedName};`),
      conn.query(`
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_name = kcu.table_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = '${sqlStringEscape(currentSchemaName)}'
              AND tc.table_name = '${sqlStringEscape(tableName)}';
        `),
      getTableColumns(currentSchemaName, tableName)
    ]);

    const count = countRes.toArray()[0]?.c || 0;
    const pkColumns = new Set(pkRes.toArray().map(r => r.column_name));
    const schemaHtml = buildSchemaHTML(tableName, count, cols, pkColumns);

    $("#tableSchema").innerHTML = schemaHtml;

    attachSchemaEventHandlers(tableName, onDeleteCallback);
  } catch (err) {
    console.error("Error showing table schema:", err);
    $("#tableSchema").innerHTML = `<p class="text-danger">Error: ${escapeHTML(err.message)}</p>`;
  }
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Generates the HTML for the schema view.
 * 
 * @param {string} tableName - Display name of the table.
 * @param {number} count - Total record count.
 * @param {Array} cols - Column metadata objects.
 * @param {Set<string>} pkColumns - Set of column names that are Primary Keys.
 * @returns {string} Rendered HTML.
 */
function buildSchemaHTML(tableName, count, cols, pkColumns) {
  let html = `
        <div class="mb-2">
          <span class="label-base">Table:</span>
          <p class="d-inline label-muted fontcode badge ms-1 p-0"> 
            <a href="#" class="link-base" data-role="insert-select" title="Insert a SELECT statement">
              ${escapeHTML(tableName)}
            </a>
          </p>
        </div>
        <div class="mb-3">
          <span class="label-base">Record Count:</span>
          <p class="d-inline label-muted fontcode badge ms-1 p-0 text-success"> ${count.toLocaleString()}</p>
        </div>`;

  if (cols.length) {
    html += `<div style="max-height:360px;overflow-y:auto;">
          <table class="table table-base mb-0">
            <thead>
              <tr>
                <th style="width:3rem">#</th>
                <th>Field</th>
                <th>Type</th>
                <th>Not Null</th>
                <th>Default</th>
                <th>Primary</th>
              </tr>
            </thead>
          <tbody>`;

    cols.forEach((row, i) => {
      const isPK = pkColumns.has(row.column_name);
      const isNotNull = row.is_nullable === 'NO';
      html += `<tr>
              <td>${i + 1}</td>
              <td title="${escapeHTML(row.column_name)}">${escapeHTML(row.column_name)}</td>
              <td>${escapeHTML(row.data_type)}</td>
              <td>${isNotNull ? "Yes" : "No"}</td>
              <td>${row.column_default != null ? escapeHTML(row.column_default) : ""}</td>
              <td>${isPK ? "Yes" : "No"}</td>
            </tr>`;
    });

    html += `</tbody></table></div>`;
    html += `
          <div class="mt-3 d-flex flex-wrap gap-2">
            <div class="btn-group flex-fill">
              <button type="button" class="btn btn-base dropdown-toggle w-100" id="exportTableDropdownBtn" data-bs-toggle="dropdown" aria-expanded="false">
                <i class="bi bi-download"></i>&nbsp;Export
              </button>
              <ul class="dropdown-menu border-0">
                <li><button class="dropdown-item small" type="button" data-export-format="csv"><i class="bi bi-filetype-csv me-2"></i>CSV</button></li>
                <li><button class="dropdown-item small" type="button" data-export-format="json"><i class="bi bi-filetype-json me-2"></i>JSON</button></li>
                <li><button class="dropdown-item small" type="button" data-export-format="parquet"><i class="bi bi-file-binary me-2"></i>Parquet</button></li>
              </ul>
            </div>
            <button id="editTypesBtn" class="btn btn-base flex-fill">
              <i class="bi bi-sliders"></i>&nbsp;Change Data Types
            </button>
            <button id="renameTableBtn" class="btn btn-base flex-fill">
              <i class="bi bi-pencil"></i>&nbsp;Rename Table
            </button>
            <button id="deleteTableBtn" class="btn btn-base danger flex-fill">
              <i class="bi bi-trash"></i>&nbsp;Delete Table
            </button>
          </div>`;
  } else {
    html += `<p class="label-muted">No column information found.</p>`;
  }

  return html;
}

/**
 * Binds event listeners to the rendered schema view elements.
 * 
 * @param {string} tableName - Targeted table name.
 * @param {Function} onDeleteCallback - Cleanup callback.
 */
function attachSchemaEventHandlers(tableName, onDeleteCallback) {
  const container = $("#tableSchema");

  const link = $('[data-role="insert-select"]', container);
  if (link) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      insertSelectStatement(tableName);
    });
  }

  const editBtn = $("#editTypesBtn");
  if (editBtn) {
    editBtn.addEventListener("click", () => openSchemaEditor(tableName));
  }

  const renameBtn = $("#renameTableBtn");
  if (renameBtn) {
    renameBtn.addEventListener("click", () => openRenameTableModal(tableName, onDeleteCallback));
  }

  const delBtn = $("#deleteTableBtn");
  if (delBtn) {
    delBtn.addEventListener("click", () => deleteTable(tableName, onDeleteCallback));
  }

  const exportButtons = $$('[data-export-format]', container);
  exportButtons.forEach(btn => btn.addEventListener("click", async () => {
    const fmt = btn.getAttribute("data-export-format");
    await exportTable(tableName, fmt);
  }));
}
