//! Tauri commands for DuckDB operations
//!
//! These commands expose the DuckDB manager functionality to the frontend.
//! All potentially long-running operations are async and use spawn_blocking
//! to avoid blocking Tauri's main event loop.
//!
//! The DB_MANAGER uses RwLock to enable parallel query execution:
//! - write() lock: Used for database open/close (exclusive access)
//! - read() lock: Used for queries and other operations (concurrent access)

use crate::duckdb_manager::{DbHandle, DuckDbError, DB_MANAGER};
use tauri::command;
use tauri::ipc::Response;

/// Open or create a database. Requires write lock.
#[command]
pub async fn duckdb_open(path: Option<String>) -> Result<DbHandle, DuckDbError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut manager = DB_MANAGER.write().map_err(|_| DuckDbError::LockPoisoned)?;
        manager.open_database(path)
    })
    .await
    .map_err(|_| DuckDbError::LockPoisoned)?
}

/// Close a database connection. Requires write lock.
#[command]
pub async fn duckdb_close(handle: DbHandle) -> Result<(), DuckDbError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut manager = DB_MANAGER.write().map_err(|_| DuckDbError::LockPoisoned)?;
        manager.close_database(handle)
    })
    .await
    .map_err(|_| DuckDbError::LockPoisoned)?
}

/// Execute a SQL query and return raw Arrow IPC bytes.
///
/// Returns the query result as a raw Arrow IPC stream via Tauri's binary Response API.
/// Uses a read lock to support parallel execution.
#[command]
pub async fn duckdb_query(handle: DbHandle, sql: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = DB_MANAGER.read().map_err(|_| "Lock poisoned".to_string())?;
        let ipc_bytes = manager.execute_query_arrow(handle, &sql).map_err(|e| e.to_string())?;
        Ok(Response::new(ipc_bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Force a dirty checkpoint.
#[command]
pub async fn duckdb_checkpoint(handle: DbHandle) -> Result<(), DuckDbError> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = DB_MANAGER.read().map_err(|_| DuckDbError::LockPoisoned)?;
        manager.force_checkpoint(handle)
    })
    .await
    .map_err(|_| DuckDbError::LockPoisoned)?
}

/// Copy a file to a base64 string.
#[command]
pub async fn duckdb_copy_file_b64(handle: DbHandle, name: String) -> Result<String, DuckDbError> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = DB_MANAGER.read().map_err(|_| DuckDbError::LockPoisoned)?;
        manager.copy_file_to_buffer_b64(handle, &name)
    })
    .await
    .map_err(|_| DuckDbError::LockPoisoned)?
}

/// Drop a registered file
#[command]
pub fn duckdb_drop_file(handle: DbHandle, name: String) -> Result<(), DuckDbError> {
    let manager = DB_MANAGER.read().map_err(|_| DuckDbError::LockPoisoned)?;
    manager.drop_file(handle, &name)
}

/// Insert Arrow IPC data into a table.
/// Receives a base64-encoded Arrow IPC stream and creates a table with data.
#[command]
pub async fn duckdb_insert_arrow_ipc(handle: DbHandle, table: String, data_b64: String) -> Result<(), DuckDbError> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = DB_MANAGER.read().map_err(|_| DuckDbError::LockPoisoned)?;
        manager.insert_arrow_ipc_b64(handle, &table, &data_b64)
    })
    .await
    .map_err(|_| DuckDbError::LockPoisoned)?
}

/// Get the temp directory path for a database instance.
/// Used for COPY TO operations that need absolute paths.
#[command]
pub fn duckdb_get_temp_dir(handle: DbHandle) -> Result<String, DuckDbError> {
    let manager = DB_MANAGER.read().map_err(|_| DuckDbError::LockPoisoned)?;
    manager.get_temp_dir_path(handle)
}

/// Register a file by copying it from a source path.
/// Used for efficient file imports without base64 overhead.
#[command]
pub async fn duckdb_register_file_path(handle: DbHandle, source_path: String, name: String) -> Result<String, DuckDbError> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = DB_MANAGER.read().map_err(|_| DuckDbError::LockPoisoned)?;
        manager.register_file_path(handle, &source_path, &name)
    })
    .await
    .map_err(|_| DuckDbError::LockPoisoned)?
}

/// Export the database to a user-chosen path.
/// Uses a temp folder to avoid Windows file locking issues.
#[command]
pub async fn duckdb_export_database(handle: DbHandle, dest_path: String) -> Result<String, DuckDbError> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = DB_MANAGER.read().map_err(|_| DuckDbError::LockPoisoned)?;
        manager.export_database(handle, &dest_path)
    })
    .await
    .map_err(|_| DuckDbError::LockPoisoned)?
}

/// Get the app-specific uploads temp directory path.
/// Used for file uploads to avoid Tauri FS permission issues with system temp.
#[command]
pub fn duckdb_get_uploads_dir() -> Result<String, DuckDbError> {
    crate::duckdb_manager::get_uploads_dir().ok_or_else(|| {
        DuckDbError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Uploads directory not initialized"
        ))
    })
}
