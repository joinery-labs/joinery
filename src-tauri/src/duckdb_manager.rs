//! DuckDB Manager - Native DuckDB connection management for Tauri
//!
//! Manages DuckDB database instances with proper lifecycle, persistence,
//! and query execution. Each database is identified by a unique handle ID.
//!
//! Query results are returned as Arrow IPC streams for maximum performance
//! and precision (no type conversions or per-row overhead).

use arrow::datatypes::DataType;
use arrow::ipc::reader::StreamReader;
use arrow::ipc::writer::StreamWriter;
use base64::{engine::general_purpose::STANDARD, Engine};
use duckdb::arrow::record_batch::RecordBatch;
use duckdb::{Connection, InterruptHandle};
use serde::Serialize;
use std::cell::UnsafeCell;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, RwLock};
use tempfile::TempDir;
use thiserror::Error;


// Error Types


/// Errors that can occur during DuckDB operations
#[derive(Debug, Error)]
pub enum DuckDbError {
    #[error("Invalid database handle: {0}")]
    InvalidHandle(u32),

    #[error("Database error: {0}")]
    Database(#[from] duckdb::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Lock poisoned")]
    LockPoisoned,

    #[error("No temp directory available for file operations")]
    NoTempDir,

    #[error("Base64 decode error: {0}")]
    Base64Decode(#[from] base64::DecodeError),

    #[error("Arrow error: {0}")]
    Arrow(#[from] arrow::error::ArrowError),

    #[error("Connection pool timeout: all connections busy")]
    PoolTimeout,
}

// Implement Serialize for Tauri command error handling
impl Serialize for DuckDbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}


// Types


/// Unique identifier for a database connection
pub type DbHandle = u32;

/// Maximum connections per database instance
const MAX_POOL_SIZE: usize = 10;

/// Connection pool state - tracks which connections are in use
struct PoolState {
    in_use: HashSet<usize>,
    connection_count: usize,
}

/// Database instance with connection pool
/// 
/// Connections are stored in an UnsafeCell to allow concurrent access
/// without holding the pool_state lock during query execution.
/// Safety is ensured by the in_use tracking in PoolState.
pub struct DbInstance {
    /// Pool state tracking (quick operations only)
    pool_state: Mutex<PoolState>,
    /// Pooled connections stored without lock - indexed access only when claimed
    connections: UnsafeCell<Vec<Connection>>,
    /// Interrupt handles per connection
    interrupts: UnsafeCell<Vec<Arc<InterruptHandle>>>,
    /// Path to the database file (None for in-memory)
    path: Option<PathBuf>,
    /// Temporary directory for file operations (imports)
    temp_dir: Option<TempDir>,
}

// Safety: Connection access is synchronized via `pool_state.in_use`.
// Only one thread can access a connection at a time (claimed via index).
unsafe impl Sync for DbInstance {}
unsafe impl Send for DbInstance {}

impl DbInstance {
    /// Create a new database instance with initial connections
    /// Pre-populates the pool with multiple connections to avoid race conditions
    /// during concurrent query execution (try_clone conflicts with active queries)
    fn new(primary_conn: Connection, path: Option<PathBuf>, temp_dir: Option<TempDir>) -> Self {
        // Pre-create all pool connections before any queries run.
        // This avoids calling `try_clone()` while other connections are actively executing,
        // which would cause "RefCell already borrowed" panics.
        
        let mut connections = Vec::with_capacity(MAX_POOL_SIZE);
        let mut interrupts = Vec::with_capacity(MAX_POOL_SIZE);
        
        for _ in 0..MAX_POOL_SIZE {
            let conn = primary_conn.try_clone().expect("Failed to clone connection during initialization");
            let interrupt = conn.interrupt_handle();
            connections.push(conn);
            interrupts.push(interrupt);
        }
        
        // Drop primary_conn - no longer needed after cloning
        drop(primary_conn);

        Self {
            pool_state: Mutex::new(PoolState {
                in_use: HashSet::new(),
                connection_count: MAX_POOL_SIZE,
            }),
            connections: UnsafeCell::new(connections),
            interrupts: UnsafeCell::new(interrupts),
            path,
            temp_dir,
        }
    }

    /// Claim a connection from the pool
    pub fn claim_connection(&self) -> Result<usize, DuckDbError> {
        let mut state = self.pool_state.lock().map_err(|_| DuckDbError::LockPoisoned)?;

        // Find a free connection from the pre-created pool
        for i in 0..state.connection_count {
            if !state.in_use.contains(&i) {
                state.in_use.insert(i);
                return Ok(i);
            }
        }

        // All connections busy
        Err(DuckDbError::PoolTimeout)
    }

    /// Release a connection back to the pool
    #[inline]
    pub fn release_connection(&self, index: usize) {
        if let Ok(mut state) = self.pool_state.lock() {
            state.in_use.remove(&index);
        }
    }

    /// Get a connection reference by index (caller must have claimed it)
    #[inline]
    pub fn connection(&self, index: usize) -> &Connection {
        // SAFETY: Access is synchronized via pool_state.in_use tracking.
        // Invariant: Only one thread can access connections[index] at a time.
        // The caller has claimed this index via claim_connection(), which:
        //   1. Holds the mutex while checking/inserting into in_use set
        //   2. Guarantees exclusive access until release_connection() is called
        // Therefore, no data races can occur on the Vec elements.
        let connections = unsafe { &*self.connections.get() };
        debug_assert!(index < connections.len(), "connection index {} out of bounds", index);
        &connections[index]
    }

    /// Get the interrupt handle for a connection
    #[inline]
    pub fn interrupt_handle(&self, index: usize) -> Arc<InterruptHandle> {
        // SAFETY: Same invariants as connection() - caller has claimed this index.
        let interrupts = unsafe { &*self.interrupts.get() };
        debug_assert!(index < interrupts.len(), "interrupt index {} out of bounds", index);
        interrupts[index].clone()
    }

    /// Force checkpoint on the first available connection
    pub fn checkpoint(&self) -> Result<(), DuckDbError> {
        let idx = self.claim_connection()?;
        let result = self.connection(idx).execute_batch("FORCE CHECKPOINT;");
        self.release_connection(idx);
        result.map_err(DuckDbError::from)
    }

    /// Get temp directory path
    pub fn get_temp_dir_path(&self) -> Result<String, DuckDbError> {
        let temp_dir = self.temp_dir.as_ref().ok_or(DuckDbError::NoTempDir)?;
        Ok(temp_dir.path().to_string_lossy().to_string())
    }

    /// Get database path
    pub fn get_path(&self) -> Option<&PathBuf> {
        self.path.as_ref()
    }

}

/// Global database manager
pub struct DuckDbManager {
    instances: HashMap<DbHandle, Arc<DbInstance>>,
    next_handle: DbHandle,
}

impl Default for DuckDbManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DuckDbManager {
    pub fn new() -> Self {
        Self {
            instances: HashMap::with_capacity(4), // Typical usage: 1-4 DBs
            next_handle: 1,
        }
    }

    /// Open or create a database at the given path
    /// If path is None, creates an in-memory database
    pub fn open_database(&mut self, path: Option<String>) -> Result<DbHandle, DuckDbError> {
        // Ensure parent directory exists for file-based databases
        if let Some(ref p) = path {
            if let Some(parent) = Path::new(p).parent() {
                fs::create_dir_all(parent)?;
            }
        }

        // Create the primary connection to the database
        let primary_conn = if let Some(ref p) = path {
            Connection::open(p)?
        } else {
            Connection::open_in_memory()?
        };

        let handle = self.next_handle;
        self.next_handle += 1;

        // Create temp directory for this instance (for file imports)
        let temp_dir = TempDir::new().ok();

        // Create DbInstance with primary connection for pool cloning
        let instance = Arc::new(DbInstance::new(primary_conn, path.map(PathBuf::from), temp_dir));

        self.instances.insert(handle, instance);

        Ok(handle)
    }

    /// Close a database connection
    pub fn close_database(&mut self, handle: DbHandle) -> Result<(), DuckDbError> {
        let instance = self
            .instances
            .remove(&handle)
            .ok_or(DuckDbError::InvalidHandle(handle))?;

        // Force checkpoint before closing to ensure WAL is flushed (file-based DBs only)
        if instance.get_path().is_some() {
            if let Err(e) = instance.checkpoint() {
                log::warn!("Checkpoint before close failed: {}", e);
            }
        }

        // Log closure for debugging
        if let Some(path) = instance.get_path() {
            log::debug!("Closing database at: {}", path.display());
        } else {
            log::debug!("Closing in-memory database (handle: {})", handle);
        }

        // Instance and all connections are dropped when Arc goes out of scope
        Ok(())
    }

    /// Execute a SQL query and return results as raw Arrow IPC bytes.
    ///
    /// Uses DuckDB's native Arrow query API for maximum performance:
    /// - Columnar data transfer (no per-row overhead).
    /// - Zero type conversions (preserves Decimal precision, timestamps, etc.).
    /// - Streaming serialization (batches written directly).
    ///
    /// On query failure, attempts to reset connection state to prevent deadlocks.
    pub fn execute_query_arrow(&self, handle: DbHandle, sql: &str) -> Result<Vec<u8>, DuckDbError> {
        let instance = self
            .instances
            .get(&handle)
            .ok_or(DuckDbError::InvalidHandle(handle))?;

        // Claim a connection from the pool
        let conn_idx = instance.claim_connection()?;
        let conn = instance.connection(conn_idx);
        let interrupt = instance.interrupt_handle(conn_idx);

        // Execute query and stream results directly to IPC format
        // This avoids collecting all batches first, reducing memory pressure
        let result = (|| -> Result<Vec<u8>, DuckDbError> {
            let mut stmt = conn.prepare(sql)?;
            
            // Use DuckDB's native Arrow query API - returns Arrow RecordBatches directly
            let arrow_result = stmt.query_arrow([])?;
            
            // Get schema from the result
            let schema = arrow_result.get_schema();
            
            // Pre-allocate buffer (1MB initial capacity to reduce reallocations)
            let mut buffer = Vec::with_capacity(1024 * 1024);
            
            // Create writer and stream batches directly
            // Each batch is written immediately and can be freed by the iterator
            let mut writer = StreamWriter::try_new(&mut buffer, &schema)?;
            for batch in arrow_result {
                writer.write(&batch)?;
            }
            writer.finish()?;
            
            Ok(buffer)
        })();

        // Handle result with error recovery
        let final_result = match result {
            Ok(buffer) => Ok(buffer),
            Err(e) => {
                // Interrupt any stuck internal DuckDB operations first.
                // This clears the internal mutex that can cause deadlocks.
                interrupt.interrupt();
                
                // Then attempt to clear any pending transaction state
                let _ = conn.execute_batch("ROLLBACK;");
                Err(e)
            }
        };

        // Always release connection back to pool
        instance.release_connection(conn_idx);

        final_result
    }

    /// Force checkpoint to persist data
    pub fn force_checkpoint(&self, handle: DbHandle) -> Result<(), DuckDbError> {
        let instance = self
            .instances
            .get(&handle)
            .ok_or(DuckDbError::InvalidHandle(handle))?;

        instance.checkpoint()
    }

    /// Copy a file to base64-encoded string (optimized for efficient file transfer via IPC)
    /// Used for exporting data from DuckDB temp files back to the frontend
    /// Handles both absolute paths and filenames (relative to temp dir)
    pub fn copy_file_to_buffer_b64(&self, handle: DbHandle, name: &str) -> Result<String, DuckDbError> {
        let instance = self
            .instances
            .get(&handle)
            .ok_or(DuckDbError::InvalidHandle(handle))?;

        // Check if name is an absolute path
        let file_path = if Path::new(name).is_absolute() {
            PathBuf::from(name)
        } else {
            let temp_dir = instance.temp_dir.as_ref().ok_or(DuckDbError::NoTempDir)?;
            temp_dir.path().join(name)
        };
        
        let data = fs::read(&file_path)?;
        Ok(STANDARD.encode(&data))
    }

    /// Drop a registered file
    /// Handles both absolute paths and filenames (relative to temp dir)
    pub fn drop_file(&self, handle: DbHandle, name: &str) -> Result<(), DuckDbError> {
        let instance = self
            .instances
            .get(&handle)
            .ok_or(DuckDbError::InvalidHandle(handle))?;

        // Check if name is an absolute path
        let file_path = if Path::new(name).is_absolute() {
            PathBuf::from(name)
        } else if let Some(ref temp_dir) = instance.temp_dir {
            temp_dir.path().join(name)
        } else {
            return Ok(()); // No temp dir and not absolute - nothing to do
        };
        
        let _ = fs::remove_file(&file_path); // Ignore errors - file may not exist
        Ok(())
    }

    /// Get the temp directory path for a database instance
    /// Used by frontend for COPY TO operations that need absolute paths
    pub fn get_temp_dir_path(&self, handle: DbHandle) -> Result<String, DuckDbError> {
        let instance = self
            .instances
            .get(&handle)
            .ok_or(DuckDbError::InvalidHandle(handle))?;

        instance.get_temp_dir_path()
    }

    /// Register a file by copying from a source path (via filesystem)
    /// Used for efficient file imports
    pub fn register_file_path(
        &self,
        handle: DbHandle,
        source_path: &str,
        name: &str,
    ) -> Result<String, DuckDbError> {
        let instance = self
            .instances
            .get(&handle)
            .ok_or(DuckDbError::InvalidHandle(handle))?;

        let temp_dir = instance.temp_dir.as_ref().ok_or(DuckDbError::NoTempDir)?;
        let dest_path = temp_dir.path().join(name);
        
        // Copy file from source to temp directory
        fs::copy(source_path, &dest_path)?;
        
        Ok(dest_path.to_string_lossy().to_string())
    }

    /// Insert Arrow IPC data into a table.
    /// Uses DuckDB's native Arrow Appender for efficient bulk insertion.
    ///
    /// On error, attempts to clean up the partially created table and reset connection state.
    pub fn insert_arrow_ipc(
        &self,
        handle: DbHandle,
        table_name: &str,
        ipc_data: &[u8],
    ) -> Result<(), DuckDbError> {
        let instance = self
            .instances
            .get(&handle)
            .ok_or(DuckDbError::InvalidHandle(handle))?;

        // Claim a connection from the pool
        let conn_idx = instance.claim_connection()?;
        let conn = instance.connection(conn_idx);
        let interrupt = instance.interrupt_handle(conn_idx);

        // Read Arrow IPC stream
        let cursor = std::io::Cursor::new(ipc_data);
        let reader = StreamReader::try_new(cursor, None)?;

        // Get schema and create table DDL
        let schema = reader.schema();
        let column_defs: Vec<String> = schema
            .fields()
            .iter()
            .map(|field| {
                let sql_type = arrow_type_to_duckdb(field.data_type());
                format!("\"{}\" {}", field.name(), sql_type)
            })
            .collect();

        // Create table
        let create_sql = format!(
            "CREATE TABLE \"{}\" ({});",
            table_name,
            column_defs.join(", ")
        );
        
        let result = (|| -> Result<(), DuckDbError> {
            conn.execute_batch(&create_sql)?;

            // Use appender for efficient bulk insert
            let mut appender = conn.appender(table_name)?;

            // Re-read the stream (reader is consumed by schema extraction)
            let cursor = std::io::Cursor::new(ipc_data);
            let reader = StreamReader::try_new(cursor, None)?;

            for batch_result in reader {
                let batch: RecordBatch = batch_result?;
                appender.append_record_batch(batch)?;
            }

            appender.flush()?;
            Ok(())
        })();

        // Handle error with cleanup
        let final_result = match result {
            Ok(()) => Ok(()),
            Err(e) => {
                // Interrupt any stuck internal DuckDB operations first
                interrupt.interrupt();
                
                let _ = conn.execute_batch(&format!("DROP TABLE IF EXISTS \"{}\";", table_name));
                let _ = conn.execute_batch("ROLLBACK;");
                Err(e)
            }
        };

        // Always release connection back to pool
        instance.release_connection(conn_idx);

        final_result
    }

    /// Insert Arrow IPC data from base64-encoded string
    /// Handles decoding internally for consistency with other file operations
    pub fn insert_arrow_ipc_b64(
        &self,
        handle: DbHandle,
        table_name: &str,
        data_b64: &str,
    ) -> Result<(), DuckDbError> {
        let ipc_data = STANDARD.decode(data_b64)?;
        self.insert_arrow_ipc(handle, table_name, &ipc_data)
    }

    /// Export database to a destination path using EXPORT/IMPORT DATABASE
    /// 
    /// This approach avoids file locking issues on Windows by:
    /// 1. EXPORT DATABASE to temp/db_export folder (SQL + Parquet files, not locked)
    /// 2. Create new DB at destination path
    /// 3. IMPORT DATABASE from temp
    /// 4. Clean up temp files
    pub fn export_database(&self, handle: DbHandle, dest_path: &str) -> Result<String, DuckDbError> {
        let instance = self
            .instances
            .get(&handle)
            .ok_or(DuckDbError::InvalidHandle(handle))?;

        // Claim a connection from the pool
        let conn_idx = instance.claim_connection()?;
        let conn = instance.connection(conn_idx);

        // Setup temp export directory
        let temp_base = APP_TEMP_DIR.lock()
            .ok()
            .and_then(|g| g.clone())
            .ok_or(DuckDbError::NoTempDir)?;
        let export_dir = temp_base.join("db_export");
        
        // Clean and create export directory
        if export_dir.exists() {
            fs::remove_dir_all(&export_dir)?;
        }
        fs::create_dir_all(&export_dir)?;
        
        // Export to temp folder using Parquet format.
        let export_path = export_dir.to_string_lossy().replace('\\', "/");
        let result = conn.execute_batch(&format!(
            "EXPORT DATABASE '{}' (FORMAT PARQUET);",
            export_path.replace('\'', "''")
        ));

        // Release connection after export
        instance.release_connection(conn_idx);

        // Check export result
        result?;
        
        // Remove destination if exists (user confirmed via save dialog)
        let dest = Path::new(dest_path);
        if dest.exists() {
            fs::remove_file(dest)?;
        }
        
        // Create new connection at destination and import
        let dest_conn = Connection::open(dest_path)?;
        dest_conn.execute_batch(&format!(
            "IMPORT DATABASE '{}';",
            export_path.replace('\'', "''")
        ))?;
        dest_conn.execute_batch("FORCE CHECKPOINT;")?;
        drop(dest_conn);
        
        // Cleanup temp files
        let _ = fs::remove_dir_all(&export_dir);
        
        Ok(dest_path.to_string())
    }
}


// Arrow Type Conversion


/// Convert Arrow DataType to DuckDB SQL type string
fn arrow_type_to_duckdb(dtype: &DataType) -> &'static str {
    match dtype {
        // Integer types
        DataType::Int8 => "TINYINT",
        DataType::Int16 => "SMALLINT",
        DataType::Int32 => "INTEGER",
        DataType::Int64 => "BIGINT",
        DataType::UInt8 => "UTINYINT",
        DataType::UInt16 => "USMALLINT",
        DataType::UInt32 => "UINTEGER",
        DataType::UInt64 => "UBIGINT",

        // Float types
        DataType::Float16 => "FLOAT",
        DataType::Float32 => "FLOAT",
        DataType::Float64 => "DOUBLE",

        // Decimal
        DataType::Decimal128(_, _) | DataType::Decimal256(_, _) => "DECIMAL",

        // Boolean
        DataType::Boolean => "BOOLEAN",

        // String types
        DataType::Utf8 | DataType::LargeUtf8 => "VARCHAR",

        // Binary types
        DataType::Binary | DataType::LargeBinary | DataType::FixedSizeBinary(_) => "BLOB",

        // Date/Time types
        DataType::Date32 | DataType::Date64 => "DATE",
        DataType::Time32(_) | DataType::Time64(_) => "TIME",
        DataType::Timestamp(_, _) => "TIMESTAMP",
        DataType::Duration(_) => "INTERVAL",
        DataType::Interval(_) => "INTERVAL",

        // Null
        DataType::Null => "VARCHAR",

        // Complex types - fallback to VARCHAR (DuckDB will handle serialization)
        DataType::List(_) | DataType::LargeList(_) | DataType::FixedSizeList(_, _) => "VARCHAR",
        DataType::Struct(_) => "VARCHAR",
        DataType::Map(_, _) => "VARCHAR",
        DataType::Union(_, _) => "VARCHAR",
        DataType::Dictionary(_, _) => "VARCHAR",

        // Unsupported - fallback
        _ => "VARCHAR",
    }
}


// Global State


pub static DB_MANAGER: LazyLock<RwLock<DuckDbManager>> =
    LazyLock::new(|| RwLock::new(DuckDbManager::new()));

/// App-specific temp directory path, set during initialization
static APP_TEMP_DIR: LazyLock<Mutex<Option<PathBuf>>> =
    LazyLock::new(|| Mutex::new(None));


// Temp Directory Management


/// Initialize the app temp directory and clean up any leftover files from previous runs
/// 
/// This should be called on app startup with the path to:
/// `{app_data}/joinery/temp`
/// 
/// It will:
/// 1. Store the path for later use by export operations
/// 2. Delete all contents of the temp folder (cleanup from crashes/power loss)
/// 3. Recreate the temp folder structure
pub fn init_temp_dir(temp_path: PathBuf) {
    log::info!("Initializing temp directory: {:?}", temp_path);
    
    // Clean up existing temp folder contents (from previous crashes)
    if temp_path.exists() {
        if let Err(e) = fs::remove_dir_all(&temp_path) {
            log::warn!("Failed to clean temp directory {:?}: {}", temp_path, e);
        }
    }
    
    // Create the temp directory structure
    if let Err(e) = fs::create_dir_all(&temp_path) {
        log::error!("Failed to create temp directory {:?}: {}", temp_path, e);
        return;
    }
    
    // Store the path for upload operations
    if let Ok(mut guard) = APP_TEMP_DIR.lock() {
        *guard = Some(temp_path);
    }
}

/// Get the uploads subdirectory within the app temp directory
/// Creates the directory if it doesn't exist
/// Returns the path as a String for use from JavaScript
pub fn get_uploads_dir() -> Option<String> {
    let guard = APP_TEMP_DIR.lock().ok()?;
    let temp_dir = guard.as_ref()?;
    let uploads_dir = temp_dir.join("uploads");
    
    // Ensure the directory exists
    if !uploads_dir.exists() {
        if let Err(e) = fs::create_dir_all(&uploads_dir) {
            log::error!("Failed to create uploads directory: {}", e);
            return None;
        }
    }
    
    Some(uploads_dir.to_string_lossy().to_string())
}
