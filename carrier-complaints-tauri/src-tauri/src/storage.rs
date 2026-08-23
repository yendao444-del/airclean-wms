use std::{collections::HashSet, path::PathBuf};

use sqlx::{
    postgres::PgPoolOptions,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    PgPool, SqlitePool,
};
use tauri::{AppHandle, Manager};

use crate::domain::{ComplaintHistoryRow, ImportedOrder, COMPLAINT_TYPE};

pub async fn local_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path: PathBuf = dir.join("carrier-complaints.sqlite3");
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("Không mở được dữ liệu khiếu nại: {error}"))?;
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS complaint_batches (
            id TEXT PRIMARY KEY,
            idempotency_key TEXT NOT NULL UNIQUE,
            carrier_code TEXT NOT NULL,
            carrier_name TEXT NOT NULL,
            reference_code TEXT NOT NULL,
            channel TEXT NOT NULL,
            recipient TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            status TEXT NOT NULL,
            order_count INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            sent_at TEXT,
            error TEXT
        )"#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS complaint_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            order_id TEXT NOT NULL,
            tracking_number TEXT NOT NULL,
            complaint_type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(platform, order_id, complaint_type),
            FOREIGN KEY(batch_id) REFERENCES complaint_batches(id)
        )"#,
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS complaint_orders_tracking_unique ON complaint_orders(tracking_number, complaint_type)",
    )
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(pool)
}

pub async fn complaint_keys(pool: &SqlitePool) -> Result<HashSet<String>, String> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT platform, order_id, tracking_number FROM complaint_orders WHERE complaint_type = ?",
    )
    .bind(COMPLAINT_TYPE)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .flat_map(|(platform, order, tracking)| {
            [
                format!(
                    "order:{}:{}",
                    platform.trim().to_lowercase(),
                    order.trim().to_lowercase()
                ),
                format!("tracking:{}", tracking.trim().to_lowercase()),
            ]
        })
        .collect())
}

pub async fn connect_orders_db() -> Result<PgPool, String> {
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| "Chưa cấu hình DATABASE_URL để đối soát đơn đã lấy.".to_string())?;
    PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(std::time::Duration::from_secs(8))
        .connect(&database_url)
        .await
        .map_err(|error| format!("Không kết nối được dữ liệu Đơn hàng: {error}"))
}

pub async fn existing_order_keys(
    pool: &PgPool,
    orders: &[ImportedOrder],
) -> Result<HashSet<String>, String> {
    let keys: Vec<String> = orders
        .iter()
        .flat_map(|order| [&order.order_id, &order.tracking_number])
        .map(|key| key.trim().to_lowercase())
        .filter(|key| !key.is_empty())
        .collect();
    if keys.is_empty() {
        return Ok(HashSet::new());
    }
    let marketplace: Vec<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT "orderNumber", "trackingNumber" FROM "Order"
           WHERE lower("source") IN ('tiktok', 'shopee', 'lazada', 'tmdt')
             AND (lower("orderNumber") = ANY($1)
                  OR lower(COALESCE("trackingNumber", '')) = ANY($1))"#,
    )
    .bind(&keys)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Không kiểm tra được bảng Order: {error}"))?;

    let completed_exports: Vec<(Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT "orderNumber", "ecommerceExportCode"
           FROM "EcommerceExport"
           WHERE "status" = 'completed'
             AND (lower(COALESCE("orderNumber", '')) = ANY($1)
                  OR lower(COALESCE("ecommerceExportCode", '')) = ANY($1))"#,
    )
    .bind(&keys)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Không kiểm tra được Bàn giao TMĐT đã hoàn tất: {error}"))?;

    Ok(marketplace
        .into_iter()
        .flat_map(|(order, tracking)| [Some(order), tracking])
        .chain(
            completed_exports
                .into_iter()
                .flat_map(|(order, code)| [order, code]),
        )
        .flatten()
        .map(|key| key.trim().to_lowercase())
        .collect())
}

pub async fn history(pool: &SqlitePool) -> Result<Vec<ComplaintHistoryRow>, String> {
    sqlx::query_as::<_, ComplaintHistoryRow>(
        r#"SELECT id, carrier_name, reference_code, status, order_count, created_at, sent_at
           FROM complaint_batches ORDER BY created_at DESC LIMIT 100"#,
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())
}
