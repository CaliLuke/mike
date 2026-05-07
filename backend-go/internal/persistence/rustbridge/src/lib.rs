use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr;
use std::time::Duration;

use surrealdb::Surreal;
use surrealdb::engine::local::{Db, SurrealKv};
use surrealdb::method::Transaction;
use surrealdb::types::Value;

pub struct BridgeHandle {
    runtime: tokio::runtime::Runtime,
    db: Option<Surreal<Db>>,
}

pub struct BridgeTx {
    runtime: *const tokio::runtime::Runtime,
    tx: Transaction<Db>,
}

unsafe extern "C" {
    fn go_surreal_tx_callback(
        tx: *mut c_void,
        body_id: usize,
        err_buf: *mut c_char,
        err_len: usize,
    ) -> c_int;
}

fn write_error(err_buf: *mut c_char, err_len: usize, message: &str) {
    if err_buf.is_null() || err_len == 0 {
        return;
    }

    let bytes = message.as_bytes();
    let copy_len = bytes.len().min(err_len.saturating_sub(1));
    unsafe {
        ptr::copy_nonoverlapping(bytes.as_ptr(), err_buf.cast::<u8>(), copy_len);
        *err_buf.add(copy_len) = 0;
    }
}

fn cstr_to_str<'a>(value: *const c_char, name: &str) -> Result<&'a str, String> {
    if value.is_null() {
        return Err(format!("{name} is null"));
    }
    unsafe { CStr::from_ptr(value) }
        .to_str()
        .map_err(|err| format!("{name} is not valid UTF-8: {err}"))
}

fn query_results_to_json(results: surrealdb::IndexedResults) -> surrealdb::Result<String> {
    let mut results = results.check()?;
    let mut values = Vec::with_capacity(results.num_statements());
    for index in 0..results.num_statements() {
        let value: Value = results.take(index)?;
        values.push(value.into_json_value());
    }
    serde_json::to_string(&values).map_err(|err| surrealdb::Error::internal(err.to_string()))
}

async fn open_surreal(path: &str) -> surrealdb::Result<Surreal<Db>> {
    let mut last_error = None;
    for _ in 0..20 {
        match Surreal::new::<SurrealKv>(path).await {
            Ok(db) => {
                db.use_ns("luke").use_db("luke").await?;
                return Ok(db);
            }
            Err(err) => {
                last_error = Some(err);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
    Err(last_error.expect("open retry failed without recording an error"))
}

fn set_output_string(out_json: *mut *mut c_char, value: String) -> Result<(), String> {
    if out_json.is_null() {
        return Err("out_json is null".to_string());
    }
    let c_value = CString::new(value).map_err(|err| format!("query JSON contains NUL: {err}"))?;
    unsafe {
        *out_json = c_value.into_raw();
    }
    Ok(())
}

fn catch_ffi(
    err_buf: *mut c_char,
    err_len: usize,
    body: impl FnOnce() -> Result<(), String>,
) -> c_int {
    let result = catch_unwind(AssertUnwindSafe(body));
    match result {
        Ok(Ok(())) => 0,
        Ok(Err(err)) => {
            write_error(err_buf, err_len, &err);
            1
        }
        Err(_) => {
            write_error(err_buf, err_len, "panic across Rust FFI boundary");
            2
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn luke_surreal_open(
    path: *const c_char,
    err_buf: *mut c_char,
    err_len: usize,
) -> *mut BridgeHandle {
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<BridgeHandle, String> {
        let path = cstr_to_str(path, "path")?;
        let runtime = tokio::runtime::Runtime::new().map_err(|err| err.to_string())?;
        let db = runtime
            .block_on(async { open_surreal(path).await })
            .map_err(|err| err.to_string())?;
        Ok(BridgeHandle {
            runtime,
            db: Some(db),
        })
    }));

    match result {
        Ok(Ok(handle)) => Box::into_raw(Box::new(handle)),
        Ok(Err(err)) => {
            write_error(err_buf, err_len, &err);
            ptr::null_mut()
        }
        Err(_) => {
            write_error(err_buf, err_len, "panic across Rust FFI boundary");
            ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn luke_surreal_close(
    handle: *mut BridgeHandle,
    err_buf: *mut c_char,
    err_len: usize,
) -> c_int {
    catch_ffi(err_buf, err_len, || {
        if handle.is_null() {
            return Ok(());
        }
        unsafe {
            let mut handle = Box::from_raw(handle);
            if let Some(db) = handle.db.take() {
                drop(db);
                handle
                    .runtime
                    .block_on(async { tokio::time::sleep(Duration::from_millis(500)).await });
            }
        }
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn luke_surreal_query(
    handle: *mut BridgeHandle,
    query: *const c_char,
    out_json: *mut *mut c_char,
    err_buf: *mut c_char,
    err_len: usize,
) -> c_int {
    catch_ffi(err_buf, err_len, || {
        if handle.is_null() {
            return Err("handle is null".to_string());
        }
        let query = cstr_to_str(query, "query")?;
        let handle = unsafe { &mut *handle };
        let db = handle
            .db
            .as_ref()
            .ok_or_else(|| "handle is closed".to_string())?;
        let json = handle
            .runtime
            .block_on(async { query_results_to_json(db.query(query).await?) })
            .map_err(|err| err.to_string())?;
        set_output_string(out_json, json)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn luke_surreal_transaction(
    handle: *mut BridgeHandle,
    body_id: usize,
    err_buf: *mut c_char,
    err_len: usize,
) -> c_int {
    catch_ffi(err_buf, err_len, || {
        if handle.is_null() {
            return Err("handle is null".to_string());
        }
        let handle = unsafe { &mut *handle };
        let db = handle
            .db
            .as_ref()
            .ok_or_else(|| "handle is closed".to_string())?
            .clone();
        let tx = handle
            .runtime
            .block_on(async { db.begin().await })
            .map_err(|err| err.to_string())?;
        let mut tx = Box::new(BridgeTx {
            runtime: &handle.runtime,
            tx,
        });
        let tx_ptr = tx.as_mut() as *mut BridgeTx;

        let callback_rc = unsafe {
            go_surreal_tx_callback(tx_ptr.cast::<c_void>(), body_id, err_buf, err_len)
        };
        let BridgeTx { tx, .. } = *tx;
        if callback_rc == 0 {
            handle
                .runtime
                .block_on(async { tx.commit().await })
                .map_err(|err| err.to_string())?;
            return Ok(());
        }

        let rollback_result = handle.runtime.block_on(async { tx.cancel().await });
        if let Err(err) = rollback_result {
            return Err(format!("rollback after transaction body error failed: {err}"));
        }
        let body_error = if err_buf.is_null() {
            "transaction body returned an error".to_string()
        } else {
            unsafe { CStr::from_ptr(err_buf) }
                .to_string_lossy()
                .into_owned()
        };
        Err(body_error)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn luke_surreal_tx_query(
    tx: *mut BridgeTx,
    query: *const c_char,
    out_json: *mut *mut c_char,
    err_buf: *mut c_char,
    err_len: usize,
) -> c_int {
    catch_ffi(err_buf, err_len, || {
        if tx.is_null() {
            return Err("transaction is null".to_string());
        }
        let query = cstr_to_str(query, "query")?;
        let tx = unsafe { &mut *tx };
        let runtime = unsafe { &*tx.runtime };
        let json = runtime
            .block_on(async { query_results_to_json(tx.tx.query(query).await?) })
            .map_err(|err| err.to_string())?;
        set_output_string(out_json, json)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn luke_surreal_free_string(value: *mut c_char) {
    if value.is_null() {
        return;
    }
    unsafe {
        drop(CString::from_raw(value));
    }
}
