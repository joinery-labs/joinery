/**
 * Main application entry point.
 */

// Day.js setup
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import utc from 'dayjs/plugin/utc';

dayjs.extend(customParseFormat);
dayjs.extend(utc);

import { initDatabase, switchDatabase, setDbTreeSelectGetter } from './core/database.js';
import { initGlobalShortcuts } from './core/keyboard-shortcuts.js';

import { logEnvironment, setupExitConfirmation, openUrl } from './platform/index.js';

import { initTheme } from './ui/theme.js';
import { notify, NOTIFICATION_TIMING } from './ui/notification-panel.js';

import {
    createAppToolbar,
    createNavigationTabs,
    createDatabaseTabCards,
    initToolbar
} from './ui/templates.js';
import { initMasonry } from './ui/masonry.js';

// Features
import { initQueryEditor, addQueryTab } from './features/query-editor/index.js';
import { initFileHandlers } from './features/file-upload/index.js';
import { initTableManager, updateTableDropdown } from './features/table-manager/index.js';
import { initExportImport } from './features/export-import/index.js';


import { getCachedElement } from './utils/dom.js';

/* --- Global Application State --- */

export const APP_STATE = {
    tabCounter: 0
};

/* --- Private State --- */

import { TreeSelect } from './ui/treeselect.js';

let _dbTreeSelect = null;

/* --- Database Selector --- */

function initDatabaseSelector() {
    const container = getCachedElement('dbSelectContainer');
    if (!container) {
        console.warn("Database selector container not found");
        return;
    }

    // Create TreeSelect
    _dbTreeSelect = new TreeSelect(container, {
        data: [],
        multiple: false,
        searchable: true,
        clearable: false,
        flat: true,
        closeOnSelect: true,
        placeholder: 'Select database'
    });

    // Register getter with database module to avoid circular dependency
    setDbTreeSelectGetter(() => _dbTreeSelect);


    _dbTreeSelect.on('change', async (value) => {
        if (!value) return;

        try {
            await switchDatabase(value);

            notify("Database", `Switched to "${value}"`, { variant: "success", delay: NOTIFICATION_TIMING.SUCCESS });
        } catch (err) {
            console.error("Database switch error:", err);
            notify("Error", "Failed to switch database: " + err.message, { variant: "danger", delay: NOTIFICATION_TIMING.ERROR });
        }
    });
}

/* --- Quick Start Card --- */

function initQuickStartCard() {
    // Documentation button
    const docsBtn = getCachedElement("quickStartDocsBtn");
    if (docsBtn) {
        docsBtn.addEventListener("click", () => {
            openUrl('https://github.com/joinery-labs/joinery#readme');
        });
    }

    // Load example button
    const btn = getCachedElement("quickStartBtn");
    if (!btn) return;

    btn.addEventListener("click", () => {
        const starterSQL = `-- Advanced sales analytics: time series, anomalies, patterns
CREATE OR REPLACE TABLE sales AS 
SELECT 
    -- Generate dataset
    ROW_NUMBER() OVER () AS id,
    products[1 + FLOOR(RANDOM() * 10)::INT] AS product,
    categories[1 + FLOOR(RANDOM() * 2)::INT] AS category,
    -- Add slight seasonality: Prices are higher in later months
    (50 + (RANDOM() * 1000) + (MONTH(sale_date) * 20))::DOUBLE AS amount,
    1 + FLOOR(RANDOM() * 20)::INT AS quantity,
    sale_date,
    regions[1 + FLOOR(RANDOM() * 4)::INT] AS region
FROM 
    (SELECT '2024-01-01'::DATE + (RANDOM() * 365)::INT AS sale_date FROM generate_series(1, 50000)),
    (VALUES (['Laptop','Monitor','Keyboard','Mouse','Tablet','Phone','Headphones','Webcam','Printer','Charger'])) AS t1(products),
    (VALUES (['Electronics','Accessories'])) AS t2(categories),
    (VALUES (['North','South','East','West'])) AS t3(regions);

-- Advanced analytics 
WITH daily_sales AS (
    SELECT 
        sale_date,
        category,
        region,
        SUM(amount * quantity) AS revenue,
        COUNT(*) AS transactions,
        APPROX_QUANTILE(amount, 0.5) AS median_price
    FROM sales
    GROUP BY ALL
),

anomalies AS (
    SELECT 
        *,
        AVG(revenue) OVER seven_days AS moving_avg,
        STDDEV(revenue) OVER seven_days AS moving_stddev,
        -- Z-score: How many standard deviations away is this revenue?
        (revenue - AVG(revenue) OVER seven_days) / 
            NULLIF(STDDEV(revenue) OVER seven_days, 0) AS z_score
    FROM daily_sales
    WINDOW seven_days AS (
        PARTITION BY category, region 
        ORDER BY sale_date 
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    )
),

growth AS (
    SELECT 
        *,
        LAG(revenue, 7) OVER (PARTITION BY category, region ORDER BY sale_date) AS revenue_last_week,
        revenue - LAG(revenue, 7) OVER (PARTITION BY category, region ORDER BY sale_date) AS wow_change,
        100.0 * (revenue - LAG(revenue, 7) OVER (PARTITION BY category, region ORDER BY sale_date)) / 
            NULLIF(LAG(revenue, 7) OVER (PARTITION BY category, region ORDER BY sale_date), 0) AS wow_growth_pct
    FROM anomalies
)

SELECT 
    sale_date,
    category,
    region,
    ROUND(revenue, 2) AS revenue,
    transactions,
    ROUND(moving_avg, 2) AS trend_line,
    ROUND(z_score, 2) AS anomaly_score,
    -- Visual flair for the user
    CASE WHEN ABS(z_score) > 2 THEN '🚨 ANOMALY' ELSE '✓' END AS status,
    ROUND(wow_growth_pct, 1) AS week_over_week_pct
FROM growth
WHERE sale_date >= '2024-03-01'
ORDER BY sale_date DESC, revenue DESC
LIMIT 50;`;

        addQueryTab(starterSQL, "Quick Start");
    });
}

/* --- Initialization --- */

async function initApp() {
    try {
        logEnvironment();

        // Create main container
        const container = document.createElement('div');
        container.className = 'container-fluid';
        document.body.appendChild(container);

        createAppToolbar();
        createNavigationTabs();
        createDatabaseTabCards();

        initMasonry();

        await initTheme();

        initToolbar();

        // Initialize database selector before database so the getter is registered when refreshDbSelect is called
        initDatabaseSelector();

        // Initialize database
        await initDatabase();

        initQuickStartCard();

        initTableManager();

        initQueryEditor();

        initFileHandlers();

        initExportImport();

        // Initialize global keyboard shortcuts (Ctrl+O, Ctrl+K)
        initGlobalShortcuts({
            loadFile: () => getCachedElement('fileInput')?.click(),
            openTabSwitcher: () => {
                const dropdownBtn = getCachedElement('tabSwitchDropdownBtn');
                if (dropdownBtn) {
                    const { Dropdown } = window.bootstrap || {};
                    if (Dropdown) {
                        const dropdown = Dropdown.getOrCreateInstance(dropdownBtn);
                        dropdown.toggle();
                    } else {
                        dropdownBtn.click();
                    }
                }
            }
        });

        await updateTableDropdown();

        // Prevent accidental navigation - setup exit confirmation 
        setupExitConfirmation();
    } catch (err) {
        console.error("Application initialization error:", err);
        notify("Error", "Failed to initialize: " + (err?.message || err), { variant: "danger", delay: NOTIFICATION_TIMING.ERROR });
    }
}

/* --- Application Start --- */

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
