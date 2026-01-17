/**
 * Confirm Modal
 * Asynchronous confirmation dialog using Bootstrap Modal
 */

import { Modal } from 'bootstrap';
import { $ } from '../utils/dom.js';

let confirmModalInstance = null;
let resolvePromise = null;

/**
 * Initialize the modal DOM structure if it doesn't exist
 */
function initModal() {
    if ($('#globalConfirmModal')) return;

    const modalHtml = `
        <div class="modal fade" id="globalConfirmModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <p id="globalConfirmTitle" class="modal-title label-title">
                            <i class="bi bi-question-circle me-2" ></i>
                            <span>Confirm Action</span>
                        </p>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <p id="globalConfirmMessage" class="label-base mb-0"></p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-base secondary" id="globalConfirmCancelBtn">
                            <i class="bi bi-x-lg"></i> Cancel
                        </button>
                        <button type="button" class="btn btn-base primary" id="globalConfirmOkBtn">
                            <i class="bi bi-check-lg"></i> Confirm
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modalEl = $('#globalConfirmModal');
    confirmModalInstance = new Modal(modalEl);

    // Event Listeners
    $('#globalConfirmCancelBtn').addEventListener('click', () => resolve(false));
    $('#globalConfirmOkBtn').addEventListener('click', () => resolve(true));

    // Handle Bootstrap hidden event (covers Escape key and Backdrop click)
    modalEl.addEventListener('hidden.bs.modal', () => resolve(false));

    // Auto-focus the Confirm button when modal opens to support keyboard usage
    modalEl.addEventListener('shown.bs.modal', () => {
        $('#globalConfirmOkBtn').focus();
    });
}

/**
 * Resolve the pending promise and hide the modal
 * @param {boolean} result 
 */
function resolve(result) {
    if (resolvePromise) {
        resolvePromise(result);
        resolvePromise = null;
    }
    if (confirmModalInstance) {
        confirmModalInstance.hide();
    }
}

/**
 * Show a confirmation modal
 * @param {string} message - Message to display
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false otherwise
 */
export function showConfirm(message) {
    initModal();

    const msgEl = $('#globalConfirmMessage');
    if (msgEl) msgEl.textContent = message;

    return new Promise((resolve) => {
        resolvePromise = resolve;
        confirmModalInstance.show();
    });
}
