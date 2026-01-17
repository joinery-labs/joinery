//! Joinery - DuckDB-powered SQL analyzer
//!
//! This crate provides a Tauri application with native DuckDB support
//! and exposes platform APIs (filesystem, dialogs) to JavaScript.

mod commands;
mod duckdb_manager;

use commands::{
    duckdb_checkpoint, duckdb_close, duckdb_copy_file_b64, duckdb_drop_file,
    duckdb_export_database, duckdb_get_temp_dir, duckdb_get_uploads_dir, duckdb_insert_arrow_ipc, duckdb_open,
    duckdb_query, duckdb_register_file_path,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging, defaulting to "warn" in release builds if RUST_LOG is not set.
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or(if cfg!(debug_assertions) { "debug" } else { "warn" })
    ).init();

    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            duckdb_open,
            duckdb_close,
            duckdb_query,
            duckdb_checkpoint,

            duckdb_register_file_path,
            duckdb_copy_file_b64,
            duckdb_drop_file,
            duckdb_insert_arrow_ipc,
            duckdb_get_temp_dir,
            duckdb_export_database,
            duckdb_get_uploads_dir,
        ])

        .setup(|app| {
            use tauri::Manager;
            
            // Get app data directory and initialize temp directory structure
            if let Some(app_data) = app.path().app_data_dir().ok() {
                // Initialize the temporary directory at `{app_data}/joinery/temp`.
                let temp_dir = app_data.join("joinery").join("temp");
                duckdb_manager::init_temp_dir(temp_dir);
            }
            
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
    {
        eprintln!("Tauri application error: {e}");
    }
}
