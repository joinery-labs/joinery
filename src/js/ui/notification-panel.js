/**
 * Notification Panel
 * Unified notification system for instant messages and operation progress tracking.
 * 
 * API:
 * - notify(title, body, options) - Show a simple auto-dismissing notification
 * - startNotification(options) - Start a progress notification, returns controller
 * 
 * The controller returned by startNotification has:
 * - update({ status, current, detail }) - Update progress
 * - end({ success, message, dismissDelay }) - Complete the operation
 */

import { escapeHTML } from '../utils/dom.js';

// Constants

const ANIMATION_DURATION_MS = 300;
const MIN_RESUME_DELAY_MS = 500;

/**
 * Standardized notification timing constants.
 * A value of 0 means the notification must be manually dismissed.
 */
export const NOTIFICATION_TIMING = {
    SUCCESS: 5000,
    WARNING: 6000,
    ERROR: 0,
    INFO: 4000
};

// State

/** @type {Map<string, NotificationState>} */
const _notifications = new Map();

/** @type {HTMLElement|null} */
let _panel = null;

/** @type {HTMLElement|null} */
let _list = null;

let _idCounter = 0;

// Types

/**
 * @typedef {Object} NotificationState
 * @property {string} id
 * @property {string} title
 * @property {string} [body]
 * @property {string} [status]
 * @property {string} [detail]
 * @property {number} [current]
 * @property {number} [total]
 * @property {string} variant
 * @property {boolean} isProgress
 * @property {boolean} isComplete
 * @property {boolean} isSuccess
 * @property {Array<string>} [details]
 * @property {HTMLElement} root
 * @property {HTMLElement} icon
 * @property {HTMLElement} title
 * @property {HTMLElement} content
 * @property {HTMLElement} progressArea
 * @property {HTMLElement} detailsArea
 * @property {HTMLElement|null} bar
 * @property {HTMLElement|null} percent
 * @property {HTMLElement|null} detailsContainer
 * @property {HTMLElement|null} detailsList
 * @property {HTMLElement|null} toggleBtn
 * @property {number|null} timeoutId
 * @property {boolean} isPaused
 * @property {number} remainingTime
 * @property {number} pauseTimestamp
 */

// Internal Helpers

function generateId(prefix) {
    return `${prefix}-${++_idCounter}`;
}

function getIconClass(notif) {
    if (notif.isComplete) {
        return notif.isSuccess ? 'bi-check-circle-fill' : 'bi-x-circle-fill';
    }
    if (notif.isProgress) {
        return 'bi-arrow-repeat spin';
    }
    switch (notif.variant) {
        case 'success': return 'bi-check-circle-fill';
        case 'danger': return 'bi-exclamation-circle-fill';
        case 'warning': return 'bi-exclamation-triangle-fill';
        default: return 'bi-info-circle-fill';
    }
}

// Panel Management

function ensurePanel() {
    if (_panel && _panel.isConnected) return;

    _panel = document.getElementById('notificationPanel');
    if (_panel) {
        _list = _panel.querySelector('.notification-list');
        return;
    }

    // Create panel if it doesn't exist
    _panel = document.createElement('div');
    _panel.id = 'notificationPanel';
    _panel.className = 'notification-panel';
    _panel.setAttribute('aria-live', 'polite');
    _panel.setAttribute('aria-atomic', 'true');
    _panel.innerHTML = `<div class="notification-list"></div>`;
    document.body.appendChild(_panel);
    _list = _panel.querySelector('.notification-list');
}

function updatePanelVisibility() {
    if (_notifications.size > 0) {
        _panel.classList.add('visible');
    } else {
        _panel.classList.remove('visible');
    }
}

// Notification Element Creation

function createNotificationElement(notif) {
    const root = document.createElement('div');
    root.className = `notification-item ${notif.variant}`;
    root.dataset.notifId = notif.id;

    root.innerHTML = `
        <div class="notification-header">
            <div class="notification-icon">
                <i class="bi ${getIconClass(notif)}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title"></div>
                <div class="notification-body"></div>
            </div>
            <button type="button" class="notification-close" aria-label="Close">
                <i class="bi bi-x"></i>
            </button>
        </div>
        <div class="notification-progress-area"></div>
        <div class="notification-details-area"></div>
    `;

    // Store element references directly on notification state
    notif.root = root;
    notif.icon = root.querySelector('.notification-icon i');
    notif.titleEl = root.querySelector('.notification-title');
    notif.content = root.querySelector('.notification-body');
    notif.progressArea = root.querySelector('.notification-progress-area');
    notif.detailsArea = root.querySelector('.notification-details-area');
    notif.bar = null;
    notif.percent = null;
    notif.detailsContainer = null;
    notif.detailsList = null;
    notif.toggleBtn = null;

    // Event listeners
    root.querySelector('.notification-close').addEventListener('click', () => dismissNotification(notif.id));
    root.addEventListener('mouseenter', () => pauseAutoDismiss(notif.id));
    root.addEventListener('mouseleave', () => resumeAutoDismiss(notif.id));

    return root;
}

// Notification Updates

function updateNotificationContent(notif) {
    notif.titleEl.textContent = notif.title;

    if (notif.isProgress) {
        const statusText = notif.status || '';
        const detailText = notif.detail ? ` — ${notif.detail}` : '';
        notif.content.textContent = statusText + detailText;
        notif.content.className = 'notification-status';
    } else {
        notif.content.textContent = notif.body || '';
        notif.content.className = 'notification-body';
    }

    notif.icon.className = `bi ${getIconClass(notif)}`;

    updateProgressBar(notif);
    updateDetailsSection(notif);
}

function updateProgressBar(notif) {
    const hasProgress = notif.isProgress &&
        typeof notif.current === 'number' &&
        typeof notif.total === 'number' &&
        notif.total > 0 &&
        !notif.isComplete;

    if (hasProgress) {
        const progressPercent = Math.round((notif.current / notif.total) * 100);

        if (!notif.bar) {
            notif.progressArea.innerHTML = `
                <div class="notification-bar-container">
                    <div class="notification-bar"></div>
                </div>
                <div class="notification-percent"></div>
            `;
            notif.bar = notif.progressArea.querySelector('.notification-bar');
            notif.percent = notif.progressArea.querySelector('.notification-percent');
        }

        notif.bar.style.width = `${progressPercent}%`;
        notif.percent.textContent = `${progressPercent}%`;
    } else if (notif.bar) {
        notif.progressArea.innerHTML = '';
        notif.bar = null;
        notif.percent = null;
    }
}

function updateDetailsSection(notif) {
    const hasDetails = notif.details && notif.details.length > 0;

    if (hasDetails) {
        if (!notif.detailsContainer) {
            notif.detailsArea.innerHTML = `
                <div class="notification-details d-none">
                    <ul class="notification-details-list"></ul>
                </div>
                <div class="notification-controls">
                    <button type="button" class="notification-toggle" aria-expanded="false">more</button>
                </div>
            `;
            notif.detailsContainer = notif.detailsArea.querySelector('.notification-details');
            notif.detailsList = notif.detailsArea.querySelector('.notification-details-list');
            notif.toggleBtn = notif.detailsArea.querySelector('.notification-toggle');

            notif.toggleBtn.addEventListener('click', () => {
                const expanded = notif.toggleBtn.getAttribute('aria-expanded') === 'true';
                notif.toggleBtn.setAttribute('aria-expanded', String(!expanded));
                notif.toggleBtn.textContent = expanded ? 'more' : 'less';
                notif.detailsContainer.classList.toggle('d-none', expanded);
            });
        }

        notif.detailsList.innerHTML = notif.details
            .map(s => `<li>${escapeHTML(s)}</li>`)
            .join('');
    } else if (notif.detailsContainer) {
        notif.detailsArea.innerHTML = '';
        notif.detailsContainer = null;
        notif.detailsList = null;
        notif.toggleBtn = null;
    }
}

function markNotificationComplete(notif) {
    notif.root.classList.add('complete');
    notif.root.classList.remove('primary', 'success', 'danger', 'warning');
    notif.root.classList.add(notif.isSuccess ? 'success' : 'danger');
}

// Auto-Dismiss

function scheduleAutoDismiss(id, delay) {
    const notif = _notifications.get(id);
    if (!notif || delay <= 0) return;

    if (notif.timeoutId) {
        clearTimeout(notif.timeoutId);
    }

    notif.remainingTime = delay;
    notif.isPaused = false;
    notif.pauseTimestamp = 0;
    notif.timeoutId = setTimeout(() => dismissNotification(id), delay);
}

function pauseAutoDismiss(id) {
    const notif = _notifications.get(id);
    if (!notif || !notif.timeoutId || notif.isPaused) return;

    clearTimeout(notif.timeoutId);
    notif.timeoutId = null;
    notif.isPaused = true;
    notif.pauseTimestamp = Date.now();
}

function resumeAutoDismiss(id) {
    const notif = _notifications.get(id);
    if (!notif || !notif.isPaused) return;

    const elapsed = Date.now() - notif.pauseTimestamp;
    const remaining = Math.max(notif.remainingTime - elapsed, MIN_RESUME_DELAY_MS);

    notif.isPaused = false;
    notif.remainingTime = remaining;
    notif.timeoutId = setTimeout(() => dismissNotification(id), remaining);
}

function dismissNotification(id) {
    const notif = _notifications.get(id);
    if (!notif) return;

    if (notif.timeoutId) {
        clearTimeout(notif.timeoutId);
        notif.timeoutId = null;
    }

    notif.root.classList.remove('visible');
    notif.root.classList.add('removing');

    setTimeout(() => {
        notif.root.remove();
        _notifications.delete(id);
        updatePanelVisibility();
    }, ANIMATION_DURATION_MS);
}

// Controller for Progress Notifications

function createController(id) {
    return {
        id,

        update({ status, current, detail }) {
            const n = _notifications.get(id);
            if (!n) return;

            if (status !== undefined) n.status = status;
            if (current !== undefined) n.current = current;
            if (detail !== undefined) n.detail = detail;

            updateNotificationContent(n);
        },

        end({ success = true, message, dismissDelay = NOTIFICATION_TIMING.SUCCESS, details } = {}) {
            const n = _notifications.get(id);
            if (!n) return;

            n.isComplete = true;
            n.isSuccess = success;
            if (message) n.status = message;
            if (details) n.details = details;

            markNotificationComplete(n);
            updateNotificationContent(n);

            if (dismissDelay > 0) {
                scheduleAutoDismiss(id, dismissDelay);
            }
        }
    };
}

// Public API

/**
 * Show a simple notification
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {Object} [options]
 * @param {string} [options.variant='primary'] - Color variant
 * @param {number} [options.delay] - Auto-dismiss delay in ms
 * @param {Array<string>} [options.details] - Expandable detail items
 * @returns {string} Notification ID
 */
export function notify(title, body, { variant = 'primary', delay = NOTIFICATION_TIMING.INFO, details } = {}) {
    ensurePanel();

    const id = generateId('notif');

    const notif = {
        id,
        title,
        body,
        variant,
        isProgress: false,
        isComplete: false,
        isSuccess: false,
        details,
        timeoutId: null,
        isPaused: false,
        remainingTime: delay,
        pauseTimestamp: 0
    };

    createNotificationElement(notif);
    _notifications.set(id, notif);
    _list.appendChild(notif.root);

    updateNotificationContent(notif);

    // Trigger reflow for animation
    notif.root.offsetHeight;
    notif.root.classList.add('visible');

    updatePanelVisibility();

    if (delay > 0) {
        scheduleAutoDismiss(id, delay);
    }

    return id;
}

/**
 * Start tracking a new operation
 * @param {Object} options
 * @param {string} options.title - Operation title
 * @param {string} options.status - Initial status message
 * @param {number} [options.total] - Total items for progress bar
 * @param {string} [options.detail] - Additional detail text
 * @returns {{ id: string, update: Function, end: Function }}
 */
export function startNotification({ title, status, total, detail }) {
    ensurePanel();

    const id = generateId('op');

    const notif = {
        id,
        title,
        status,
        detail,
        current: total ? 0 : undefined,
        total,
        variant: 'primary',
        isProgress: true,
        isComplete: false,
        isSuccess: false,
        timeoutId: null,
        isPaused: false,
        remainingTime: 0,
        pauseTimestamp: 0
    };

    createNotificationElement(notif);
    _notifications.set(id, notif);
    _list.appendChild(notif.root);

    updateNotificationContent(notif);

    // Trigger reflow for animation
    notif.root.offsetHeight;
    notif.root.classList.add('visible');

    updatePanelVisibility();

    return createController(id);
}
