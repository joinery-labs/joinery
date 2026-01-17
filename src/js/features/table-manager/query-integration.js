/**
 * Query Integration
 * 
 * Facilitates interaction with the Query Editor, such as injecting SQL statements.
 */

import { quoteIdent } from '../../utils/sql.js';
import { $ } from '../../utils/dom.js';
import { getCurrentSchema } from './table-state.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Injects a SELECT statement for the specified table into the active query editor.
 * If the Database tab is active, adds a new query tab.
 * 
 * @param {string} tableName - The target table name.
 */
export async function insertSelectStatement(tableName) {
    const { addQueryTab } = await import('../query-editor/index.js');
    const activePane = $(".tab-pane.show.active");
    const isOnDatabaseTab = activePane && activePane.id === "content-1";

    const currentSchemaName = getCurrentSchema();
    const qualifiedName =
        currentSchemaName && currentSchemaName !== "main"
            ? `${quoteIdent(currentSchemaName)}.${quoteIdent(tableName)}`
            : quoteIdent(tableName);

    if (isOnDatabaseTab) {
        addQueryTab(`SELECT * FROM ${qualifiedName} LIMIT 50;`, tableName);
    } else {
        const textarea = $("textarea.sql-editor", activePane);
        if (textarea) {
            textarea.value = `SELECT * FROM ${qualifiedName} LIMIT 50;`;
            textarea.focus();
        }
    }
}
