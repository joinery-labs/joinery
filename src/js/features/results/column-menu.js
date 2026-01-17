/**
 * Column Menu UI
 * Manages the column header menu with filter and sort controls.
 */

import { escapeHTML, $ } from '../../utils/dom.js';
import { TreeSelect } from '../../ui/treeselect.js';

// ============================================================================
// MODULE STATE - TreeSelect Instance Management
// ============================================================================

/**
 * TreeSelect instance for boolean filter dropdown (Any/True/False)
 * @type {TreeSelect|null}
 */
let boolSelectInstance = null;

/**
 * TreeSelect instance for text operator dropdown (contains/equals)
 * @type {TreeSelect|null}
 */
let textOpSelectInstance = null;

/**
 * Data for boolean filter TreeSelect
 */
const BOOL_FILTER_DATA = Object.freeze([
  { id: '', label: 'Any' },
  { id: 'true', label: 'True' },
  { id: 'false', label: 'False' }
]);

/**
 * Data for text operator TreeSelect
 */
const TEXT_OP_DATA = Object.freeze([
  { id: 'contains', label: 'contains' },
  { id: 'equals', label: 'equals' }
]);

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Clamp position to viewport bounds
 * @param {HTMLElement} el - Element to position
 * @param {number} left - Desired left position
 * @param {number} top - Desired top position
 * @returns {object} Clamped position {left, top}
 */
function clampToViewport(el, left, top) {
  const pad = 8;
  const maxLeft = window.innerWidth - el.offsetWidth - pad;
  const maxTop = window.innerHeight - el.offsetHeight - pad;
  return {
    left: Math.max(pad, Math.min(left, maxLeft)),
    top: Math.max(pad, Math.min(top, maxTop))
  };
}

/**
 * Enable dragging on menu element
 * @param {HTMLElement} menu - Menu element
 * @param {AbortSignal} signal - Abort signal for cleanup
 */
function enableDrag(menu, signal) {
  const head = $(".head", menu);
  if (!head) return;

  let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;

  const onMove = (e) => {
    if (!dragging) return;
    const pos = clampToViewport(menu, sl + (e.clientX - sx), st + (e.clientY - sy));
    menu.style.left = pos.left + "px";
    menu.style.top = pos.top + "px";
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  head.addEventListener("mousedown", (e) => {
    dragging = true;
    document.body.style.userSelect = "none";
    sx = e.clientX;
    sy = e.clientY;
    const rect = menu.getBoundingClientRect();
    sl = rect.left;
    st = rect.top;
    window.addEventListener("mousemove", onMove, { signal });
    window.addEventListener("mouseup", onUp, { once: true, signal });
    e.preventDefault();
  });
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Build column menu HTML
 * @param {string} columnName - Column name
 * @param {string} type - Column type ('number', 'date', 'datetime', 'time', 'boolean', or 'text')
 * @returns {string} HTML string
 */
export function buildColumnMenuHTML(columnName, type) {
  // Show info button for date/datetime/time columns
  const showTipBtn = type === "date" || type === "datetime" || type === "time";

  return `
    <div class="head mb-1 d-flex align-items-center justify-content-between">
      <span>${escapeHTML(columnName)}</span>
      ${showTipBtn ? `<button class="btn btn-link p-0" id="tipBtn" title="Format info"><i class="bi bi-info-circle"></i></button>` : ""}
    </div>
      <div class="colmenu-section-title">Sort</div>
      <div class="d-flex gap-2 mb-2">
        <div class="form-check form-check-base">
          <input class="form-check-input" type="radio" name="sortDir" id="sortAsc" value="asc">
          <label class="form-check-label" for="sortAsc">Ascending</label>
        </div>
        <div class="form-check form-check-base">
          <input class="form-check-input" type="radio" name="sortDir" id="sortDesc" value="desc">
          <label class="form-check-label" for="sortDesc">Descending</label>
        </div>
        <div class="form-check form-check-base">
          <input class="form-check-input" type="radio" name="sortDir" id="sortNone" value="none" checked>
          <label class="form-check-label" for="sortNone">None</label>
        </div>
      </div>
      <div class="colmenu-section-title">Filter</div>
      ${buildFilterHTML(type)}
      <div class="d-flex justify-content-end gap-2 mt-4">
        <button class="btn btn-base secondary btn-clear">Clear</button>
        <button class="btn btn-base primary btn-apply">Apply</button>
      </div>
    `;
}

/**
 * Build filter HTML based on column type
 * @param {string} type - Column type
 * @returns {string} HTML string for filter controls
 */
function buildFilterHTML(type) {
  if (type === "number") {
    return `
        <div class="row g-2 mb-2">
          <div class="col"><input type="number" class="form-control form-control-base" id="numMin" placeholder="Min"></div>
          <div class="col"><input type="number" class="form-control form-control-base" id="numMax" placeholder="Max"></div>
        </div>
        `;
  }

  if (type === "date" || type === "datetime") {
    return `
        <div class="row g-2 mb-2">
          <div class="col"><input type="text" class="form-control form-control-base" id="dateFrom" placeholder="${type === 'date' ? '1999-12-31' : '1999-12-31 23:59:59'}"></div>
          <div class="col"><input type="text" class="form-control form-control-base" id="dateTo" placeholder="${type === 'date' ? '2050-12-31' : '2050-12-31 23:59:59'}"></div>
        </div>
        <div class="alert alert-info small py-2 px-2 d-none" id="tipAlert">
          <div class="fw-semibold mb-1">Accepted formats</div>
          <div>Date: <ul><li><code>31/12/1999</code></li><li><code>1999-12-31</code></li></ul></div>
          <div>DateTime: <ul><li><code>31/12/1999 23:59</code></li><li><code>1999-12-31 23:59</code></li><li><code>31/12/1999 23:59:59.999 Z</code></li><li><code>1999-12-31 23:59:59.999 Z</code></li></ul></div>
        </div>
        `;
  }

  if (type === "time") {
    return `
        <div class="row g-2 mb-2">
          <div class="col"><input type="text" class="form-control form-control-base" id="timeFrom" placeholder="00:00:00"></div>
          <div class="col"><input type="text" class="form-control form-control-base" id="timeTo" placeholder="23:59:59"></div>
        </div>
        <div class="alert alert-info small py-2 px-2 d-none" id="tipAlert">
          <div class="fw-semibold mb-1">Accepted formats</div>
          <div>Time: <ul><li><code>14:30</code></li><li><code>14:30:45</code></li><li><code>14:30:45.123</code></li></ul></div>
        </div>
        `;
  }

  if (type === "boolean") {
    return `
        <div class="row g-2 mb-2">
          <div class="col">
            <div id="boolValContainer"></div>
          </div>
        </div>
        `;
  }

  // Default: text filter
  return `
        <div class="row g-2 mb-2">
          <div class="col-8"><input type="text" class="form-control form-control-base" id="textVal" placeholder="Value"></div>
          <div class="col-4">
            <div id="textOpContainer"></div>
          </div>
        </div>
        <div class="form-check form-check-base mb-2">
          <input class="form-check-input" type="checkbox" id="textCase">
          <label class="form-check-label" for="textCase">Case sensitive</label>
        </div>
    `;
}

/**
 * Hydrate menu inputs with current filter/sort state
 * @param {HTMLElement} menu - Menu element
 * @param {number} sortCol - Current sort column index (-1 if none)
 * @param {number} colIdx - This column's index
 * @param {boolean} sortAsc - Current sort direction
 * @param {object} filter - Current filter state for this column
 * @param {string} type - Column type
 */
export function hydrateColumnMenuInputs(menu, sortCol, colIdx, sortAsc, filter, type) {
  // Hydrate sort radios
  if (sortCol === colIdx) {
    $("#sortAsc", menu).checked = sortAsc;
    $("#sortDesc", menu).checked = !sortAsc;
  } else {
    $("#sortNone", menu).checked = true;
  }

  // Hydrate filter inputs
  if (filter) {
    if (filter.type === "number") {
      $("#numMin", menu).value = filter.min ?? "";
      $("#numMax", menu).value = filter.max ?? "";
    } else if (filter.type === "date" || filter.type === "datetime") {
      $("#dateFrom", menu).value = filter.from ?? "";
      $("#dateTo", menu).value = filter.to ?? "";
    } else if (filter.type === "time") {
      $("#timeFrom", menu).value = filter.from ?? "";
      $("#timeTo", menu).value = filter.to ?? "";
    } else if (filter.type === "boolean") {
      // Boolean filter value is set via TreeSelect in initializeColumnMenuSelects
      // The instance will be initialized after this function is called
    } else if (filter.type === "text") {
      $("#textVal", menu).value = filter.value ?? "";
      // Text operator is set via TreeSelect in initializeColumnMenuSelects
      $("#textCase", menu).checked = !!filter.case;
    }
  }

  // Setup tip button for date/datetime/time columns
  const tipBtn = $("#tipBtn", menu);
  if (tipBtn && (type === "date" || type === "datetime" || type === "time")) {
    const tip = $("#tipAlert", menu);
    if (tip) {
      tipBtn.addEventListener("click", () => tip.classList.toggle("d-none"));
    }
  }
}

/**
 * Extract filter/sort values from menu inputs
 * @param {HTMLElement} menu - Menu element
 * @param {string} type - Column type
 * @returns {object} Extracted values {sortDir, filter}
 */
export function extractMenuValues(menu, type) {
  const sortDir = $("#sortAsc", menu).checked ? "asc"
    : $("#sortDesc", menu).checked ? "desc"
      : "none";

  let filter = null;

  if (type === "number") {
    const min = $("#numMin", menu).value;
    const max = $("#numMax", menu).value;
    if (min !== "" || max !== "") {
      filter = {
        type: "number",
        min: (min !== "" ? parseFloat(min) : null),
        max: (max !== "" ? parseFloat(max) : null)
      };
    }
  } else if (type === "date" || type === "datetime") {
    const from = $("#dateFrom", menu).value.trim();
    const to = $("#dateTo", menu).value.trim();
    if (from || to) {
      filter = {
        type,
        from: from || null,
        to: to || null
      };
    }
  } else if (type === "time") {
    const from = $("#timeFrom", menu).value.trim();
    const to = $("#timeTo", menu).value.trim();
    if (from || to) {
      filter = {
        type: "time",
        from: from || null,
        to: to || null
      };
    }
  } else if (type === "boolean") {
    const val = boolSelectInstance ? boolSelectInstance.getValue() : '';
    if (val !== '' && val !== null) {
      filter = {
        type: "boolean",
        value: val === "true"
      };
    }
  } else {
    const value = $("#textVal", menu).value.trim();
    const op = textOpSelectInstance ? textOpSelectInstance.getValue() : 'contains';
    const cs = $("#textCase", menu).checked;
    if (value) {
      filter = {
        type: "text",
        value,
        op: op || 'contains',
        case: cs
      };
    }
  }

  return { sortDir, filter };
}

/**
 * Open column menu at anchor element
 * @param {HTMLElement} menu - Menu element
 * @param {HTMLElement} anchorTh - Anchor TH element
 */
export function positionColumnMenu(menu, anchorTh) {
  const rect = anchorTh.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, window.innerWidth - 380) + "px";
  menu.style.top = (rect.bottom + 6) + "px";

  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    const pos = clampToViewport(menu, r.left, r.top);
    menu.style.left = pos.left + "px";
    menu.style.top = pos.top + "px";
  });
}

/**
 * Setup column menu interactivity
 * @param {HTMLElement} menu - Menu element
 * @param {AbortSignal} signal - Abort signal for cleanup
 */
export function setupColumnMenuInteractivity(menu, signal) {
  enableDrag(menu, signal);
}

// ============================================================================
// TREESELECT LIFECYCLE MANAGEMENT
// ============================================================================

/**
 * Initialize TreeSelect instances for column menu dropdowns
 * Must be called after menu HTML is rendered and hydrated
 * @param {HTMLElement} menu - Menu element
 * @param {string} type - Column type ('boolean', 'text', etc.)
 * @param {object|null} filter - Current filter state for pre-selection
 */
export function initializeColumnMenuSelects(menu, type, filter) {
  // Clean up any existing instances first
  destroyColumnMenuSelects();

  if (type === 'boolean') {
    const container = $('#boolValContainer', menu);
    if (container) {
      boolSelectInstance = new TreeSelect(container, {
        data: BOOL_FILTER_DATA,
        multiple: false,
        flat: true,
        searchable: false,
        placeholder: 'Select...',
        closeOnSelect: true,
        clearable: false,
        useFixedPosition: true
      });

      // Pre-select based on filter state
      if (filter && filter.type === 'boolean') {
        const val = filter.value === true ? 'true' : filter.value === false ? 'false' : '';
        boolSelectInstance.setValue(val);
      } else {
        boolSelectInstance.setValue('');
      }
    }
  } else if (!type || type === 'text') {
    // Text filter is the default for text columns and unrecognized types
    const container = $('#textOpContainer', menu);
    if (container) {
      textOpSelectInstance = new TreeSelect(container, {
        data: TEXT_OP_DATA,
        multiple: false,
        flat: true,
        searchable: false,
        placeholder: 'Select...',
        closeOnSelect: true,
        clearable: false,
        useFixedPosition: true
      });

      // Pre-select based on filter state
      if (filter && filter.type === 'text' && filter.op) {
        textOpSelectInstance.setValue(filter.op);
      } else {
        textOpSelectInstance.setValue('contains');
      }
    }
  }
}

/**
 * Destroy all TreeSelect instances to prevent memory leaks
 * Must be called when menu is closed or before re-initializing
 */
export function destroyColumnMenuSelects() {
  if (boolSelectInstance) {
    try {
      boolSelectInstance.destroy();
    } catch (e) {
      // Ignore destruction errors
    }
    boolSelectInstance = null;
  }

  if (textOpSelectInstance) {
    try {
      textOpSelectInstance.destroy();
    } catch (e) {
      // Ignore destruction errors
    }
    textOpSelectInstance = null;
  }
}
