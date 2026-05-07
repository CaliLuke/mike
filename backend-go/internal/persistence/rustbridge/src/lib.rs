use std::ffi::{CStr, c_char};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use surrealdb::Surreal;
use surrealdb::engine::local::SurrealKv;
use surrealdb::types::SurrealValue;

#[derive(Debug, Serialize, SurrealValue)]
struct SpikeProject {
    name: String,
    status: String,
    tags: Vec<String>,
}

#[derive(Debug, Deserialize, SurrealValue)]
struct PersistedProject {
    name: String,
    status: String,
    tags: Vec<String>,
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

fn run_spike(path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let runtime = tokio::runtime::Runtime::new()?;

    runtime.block_on(async {
        let db = Surreal::new::<SurrealKv>(path).await?;
        db.use_ns("luke").use_db("luke").await?;
        db.query("DEFINE TABLE spike_project SCHEMALESS")
            .await?
            .check()?;
        let _: Option<PersistedProject> = db
            .upsert(("spike_project", "first"))
            .content(SpikeProject {
                name: "Initial application".to_string(),
                status: "draft".to_string(),
                tags: vec!["local".to_string(), "surrealkv".to_string()],
            })
            .await?;
        let _: Option<PersistedProject> = db
            .update(("spike_project", "first"))
            .merge(SpikeProject {
                name: "Initial application".to_string(),
                status: "submitted".to_string(),
                tags: vec!["local".to_string(), "surrealkv".to_string()],
            })
            .await?;
        drop(db);

        // Surreal's local engine closes asynchronously after the last client drops.
        // Give that router task a bounded window to flush and release SurrealKV's lock.
        let mut reopened = None;
        let mut last_open_error = None;
        for _ in 0..20 {
            match Surreal::new::<SurrealKv>(path).await {
                Ok(db) => {
                    reopened = Some(db);
                    last_open_error = None;
                    break;
                }
                Err(err) => {
                    last_open_error = Some(err);
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
        let Some(reopened) = reopened else {
            return Err(last_open_error
                .expect("reopen error should be set after retry failure")
                .into());
        };
        reopened.use_ns("luke").use_db("luke").await?;
        let record: Option<PersistedProject> = reopened.select(("spike_project", "first")).await?;
        let record = record.ok_or("persisted record missing after reopen")?;
        if record.name != "Initial application" || record.status != "submitted" {
            return Err(format!("unexpected persisted record: {:?}", record).into());
        }
        if record.tags.len() != 2 || record.tags[1] != "surrealkv" {
            return Err(format!("unexpected persisted tags: {:?}", record.tags).into());
        }

        let _: Option<PersistedProject> = reopened.delete(("spike_project", "first")).await?;
        let deleted: Option<PersistedProject> = reopened.select(("spike_project", "first")).await?;
        if deleted.is_some() {
            return Err("deleted record is still present".into());
        }

        Ok(())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn luke_surreal_persistence_spike(
    path: *const c_char,
    err_buf: *mut c_char,
    err_len: usize,
) -> i32 {
    let result = catch_unwind(AssertUnwindSafe(|| {
        if path.is_null() {
            return Err("path is null".into());
        }
        let path = unsafe { CStr::from_ptr(path) }
            .to_str()
            .map_err(|err| format!("path is not valid UTF-8: {err}"))?;
        run_spike(path)
    }));

    match result {
        Ok(Ok(())) => 0,
        Ok(Err(err)) => {
            write_error(err_buf, err_len, &err.to_string());
            1
        }
        Err(_) => {
            write_error(err_buf, err_len, "panic across Rust FFI boundary");
            2
        }
    }
}
