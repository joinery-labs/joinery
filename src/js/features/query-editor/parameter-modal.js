/**
 * Parameter Modal
 * 
 * Provides the user interface for inputting parameter values when executing a parameterized query.
 */

import { Modal } from 'bootstrap';

import { escapeHTML, $ } from '../../utils/dom.js';
import { substituteParameters } from '../../utils/parameters.js';

// Singleton reference to the Bootstrap modal instance
let parameterModalInstance = null;

/**
 * Create the parameter input modal HTML if it doesn't exist
 */
function ensureModalExists() {
    if (document.getElementById('parameterInputModal')) return;

    const modalHtml = `
        <div class="modal fade" id="parameterInputModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <p class="modal-title label-title">
                            Enter Parameter Values
                        </p>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <p class="label-base fontcode mb-3" id="paramModalQueryName"></p>
                        <div id="parameterInputsContainer"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-base secondary" data-bs-dismiss="modal">Cancel</button>
                        <button id="runWithParamsBtn" class="btn btn-base primary">
                            <i class="bi bi-play-circle"></i>Run Query
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Show the parameter input modal
 * @param {object} query - Query object with sql, name, and parameters
 * @returns {Promise<string|null>} Resolved SQL with substituted values, or null if cancelled
 */
export function showParameterInputModal(query) {
    return new Promise((resolve) => {
        ensureModalExists();

        const modal = $("#parameterInputModal");
        const container = $("#parameterInputsContainer");
        const queryNameEl = $("#paramModalQueryName");
        const runBtn = $("#runWithParamsBtn");

        // Set query name
        queryNameEl.textContent = `${query.name}`;

        // Build parameter inputs
        const parameters = query.parameters || [];

        if (parameters.length === 0) {
            // If no parameters are detected, resolve immediately with the original SQL
            resolve(query.sql);
            return;
        }

        container.innerHTML = parameters.map((p, idx) => `
            <div class="mb-3">
                <label class="form-label" for="paramInput_${idx}">
                    <span class="label-muted fontcode" style="color: var(--bs-pink);">{{${escapeHTML(p.name)}}}</span>
                </label>
                <input type="text" 
                    class="form-control form-control-base param-value-input" 
                    id="paramInput_${idx}"
                    data-param-name="${escapeHTML(p.name)}"
                    value="${escapeHTML(p.defaultValue || '')}"
                    placeholder="Enter value for ${escapeHTML(p.name)}">
            </div>
        `).join('');

        // Focus first input when modal opens
        modal.addEventListener('shown.bs.modal', () => {
            const firstInput = container.querySelector('input');
            if (firstInput) firstInput.focus();
        }, { once: true });

        // Handle cancel/close
        let resolved = false;

        // Keydown handler for Enter key submit
        const handleKeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runBtn.click();
            }
        };

        const handleClose = () => {
            // Remove keydown listener to prevent memory leaks and duplicate event handling
            container.removeEventListener('keydown', handleKeydown);
            if (!resolved) {
                resolved = true;
                resolve(null);
            }
        };

        modal.addEventListener('hidden.bs.modal', handleClose, { once: true });

        // Handle run button
        runBtn.onclick = () => {
            if (resolved) return;

            // Collect values
            const values = {};
            const inputs = container.querySelectorAll('.param-value-input');

            for (const input of inputs) {
                const paramName = input.getAttribute('data-param-name');
                values[paramName] = input.value;
            }

            // Substitute parameters
            const finalSql = substituteParameters(query.sql, values);

            resolved = true;

            // Blur active element before hiding to prevent focus trapping or aria-hidden conflicts
            if (document.activeElement) {
                document.activeElement.blur();
            }

            // Hide modal after short delay
            setTimeout(() => {
                if (parameterModalInstance) {
                    parameterModalInstance.hide();
                }
            }, 10);

            resolve(finalSql);
        };

        // Allow Enter key to submit
        container.addEventListener('keydown', handleKeydown);

        // Show modal
        parameterModalInstance = new Modal(modal);
        parameterModalInstance.show();
    });
}

/**
 * Check if a query has parameters that need prompting
 * @param {object} query - Query object
 * @returns {boolean}
 */
export function queryNeedsParameters(query) {
    return query.parameters && query.parameters.length > 0;
}
