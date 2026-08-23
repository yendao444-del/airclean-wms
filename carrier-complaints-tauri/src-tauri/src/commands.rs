use std::collections::{BTreeMap, HashSet};

use chrono::Local;
use lettre::{
    message::Mailbox, transport::smtp::authentication::Credentials, AsyncSmtpTransport,
    AsyncTransport, Message, Tokio1Executor,
};
use tauri::AppHandle;
use uuid::Uuid;

use crate::{
    domain::{
        AppStatus, CarrierGroup, ComplaintHistoryRow, ExcludedOrder, ImportSummary, ImportedOrder,
        SendComplaintRequest, SendComplaintResult, COMPLAINT_TYPE,
    },
    parser, storage,
};

fn recipient_for(carrier_code: &str) -> String {
    let env_key = format!("{}_COMPLAINT_EMAIL", carrier_code.to_uppercase());
    std::env::var(env_key).unwrap_or_default()
}

fn build_groups(orders: Vec<ImportedOrder>, date_key: &str) -> Vec<CarrierGroup> {
    let mut grouped = BTreeMap::<String, Vec<ImportedOrder>>::new();
    for order in orders {
        grouped
            .entry(order.carrier_code.clone())
            .or_default()
            .push(order);
    }
    grouped
        .into_iter()
        .map(|(code, mut orders)| {
            orders.sort_by(|a, b| a.tracking_number.cmp(&b.tracking_number));
            let carrier_name = orders
                .first()
                .map(|item| item.carrier_name.clone())
                .unwrap_or_default();
            let shopee_count = orders
                .iter()
                .filter(|item| item.platform == "Shopee")
                .count();
            let tiktok_count = orders
                .iter()
                .filter(|item| item.platform == "TikTok Shop")
                .count();
            CarrierGroup {
                channel: format!("Email {code}"),
                recipient: recipient_for(&code),
                reference_code: format!("KN-{code}-{date_key}-KHO01"),
                carrier_code: code,
                carrier_name,
                shopee_count,
                tiktok_count,
                orders,
            }
        })
        .collect()
}

fn reconcile(
    parsed: Vec<ImportedOrder>,
    existing_orders: &HashSet<String>,
    complaint_keys: &HashSet<String>,
    database_connected: bool,
) -> (Vec<ImportedOrder>, Vec<ExcludedOrder>) {
    let mut eligible = Vec::new();
    let mut excluded = Vec::new();
    for order in parsed {
        let (reason, reason_code) = if !database_connected {
            (Some("Không đối soát được dữ liệu Đơn hàng"), "NEEDS_REVIEW")
        } else if existing_orders.contains(&order.order_id.trim().to_lowercase())
            || existing_orders.contains(&order.tracking_number.trim().to_lowercase())
        {
            (Some("Đã có trong Đơn hàng / đã pickup"), "ALREADY_PICKED")
        } else if order
            .complaint_keys()
            .iter()
            .any(|key| complaint_keys.contains(key))
        {
            (
                Some("Đã khiếu nại không lấy hàng trước đó"),
                "DUPLICATE_COMPLAINT",
            )
        } else if order.carrier_code == "UNKNOWN" || order.carrier_name.is_empty() {
            (
                Some("Không nhận diện được đơn vị vận chuyển"),
                "NEEDS_REVIEW",
            )
        } else {
            (None, "")
        };
        if let Some(reason) = reason {
            excluded.push(ExcludedOrder {
                order,
                reason: reason.into(),
                reason_code: reason_code.into(),
            });
        } else {
            eligible.push(order);
        }
    }
    (eligible, excluded)
}

#[tauri::command]
pub async fn get_app_status() -> AppStatus {
    let database_configured = std::env::var("DATABASE_URL").is_ok();
    let smtp_configured = [
        "SMTP_HOST",
        "SMTP_USERNAME",
        "SMTP_PASSWORD",
        "COMPLAINT_FROM",
    ]
    .iter()
    .all(|key| {
        std::env::var(key)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    });
    AppStatus {
        database_configured,
        smtp_configured,
        safe_to_send: database_configured && smtp_configured,
        mode_label: if database_configured && smtp_configured {
            "Sẵn sàng gửi"
        } else {
            "Chế độ an toàn"
        }
        .into(),
    }
}

#[tauri::command]
pub async fn import_order_files(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<ImportSummary, String> {
    let (parsed, file_count) = parser::parse_paths(&paths)?;
    if parsed.is_empty() {
        return Err("Không tìm thấy đơn Shopee/TikTok có mã đơn và mã vận đơn hợp lệ.".into());
    }
    let local = storage::local_pool(&app).await?;
    let complaint_keys = storage::complaint_keys(&local).await?;
    let (database_connected, existing_orders) = match storage::connect_orders_db().await {
        Ok(pool) => (true, storage::existing_order_keys(&pool, &parsed).await?),
        Err(_) => (false, HashSet::new()),
    };
    let parsed_count = parsed.len();
    let (eligible, excluded) = reconcile(
        parsed,
        &existing_orders,
        &complaint_keys,
        database_connected,
    );
    let existing_order_count = excluded
        .iter()
        .filter(|item| item.reason_code == "ALREADY_PICKED")
        .count();
    let duplicate_complaint_count = excluded
        .iter()
        .filter(|item| item.reason_code == "DUPLICATE_COMPLAINT")
        .count();
    let needs_review_count = excluded
        .iter()
        .filter(|item| item.reason_code == "NEEDS_REVIEW")
        .count();
    let now = Local::now();
    let groups = build_groups(eligible, &now.format("%Y%m%d").to_string());
    Ok(ImportSummary {
        session_id: Uuid::new_v4().to_string(),
        imported_at: now.to_rfc3339(),
        file_count,
        parsed_count,
        eligible_count: groups.iter().map(|group| group.orders.len()).sum(),
        existing_order_count,
        duplicate_complaint_count,
        needs_review_count,
        database_connected,
        groups,
        excluded,
    })
}

fn mail_body(request: &SendComplaintRequest) -> String {
    let tracking = request
        .group
        .orders
        .iter()
        .map(|order| {
            format!(
                "- {} ({}, mã đơn {})",
                order.tracking_number, order.platform, order.order_id
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Kính gửi {},\n\n{} đã chuẩn bị bàn giao các đơn dưới đây trong ngày {}. Đến thời điểm {}, các đơn vẫn chưa được cập nhật trạng thái lấy hàng. Vui lòng kiểm tra và hỗ trợ điều phối lấy hàng.\n\nMã tham chiếu: {}\n\nDanh sách vận đơn:\n{}\n\nTrân trọng,\nDBY Software POS",
        request.group.carrier_name,
        request.warehouse,
        Local::now().format("%d/%m/%Y"),
        request.cutoff,
        request.group.reference_code,
        tracking,
    )
}

#[tauri::command]
pub async fn send_complaint(
    app: AppHandle,
    request: SendComplaintRequest,
) -> Result<SendComplaintResult, String> {
    if request.group.orders.is_empty() {
        return Err("Danh sách gửi đang trống.".into());
    }
    if request.group.recipient.trim().is_empty() {
        return Err("DVVC này chưa có kênh email khiếu nại.".into());
    }

    let orders_db = storage::connect_orders_db().await?;
    let latest_existing = storage::existing_order_keys(&orders_db, &request.group.orders).await?;
    if !latest_existing.is_empty() {
        return Err(format!(
            "Đã dừng gửi: {} đơn vừa xuất hiện trong Đơn hàng sau lần import.",
            latest_existing.len()
        ));
    }

    let smtp_host =
        std::env::var("SMTP_HOST").map_err(|_| "Chưa cấu hình SMTP_HOST.".to_string())?;
    let smtp_username =
        std::env::var("SMTP_USERNAME").map_err(|_| "Chưa cấu hình SMTP_USERNAME.".to_string())?;
    let smtp_password =
        std::env::var("SMTP_PASSWORD").map_err(|_| "Chưa cấu hình SMTP_PASSWORD.".to_string())?;
    let from: Mailbox = std::env::var("COMPLAINT_FROM")
        .map_err(|_| "Chưa cấu hình COMPLAINT_FROM.".to_string())?
        .parse()
        .map_err(|_| "COMPLAINT_FROM không hợp lệ.".to_string())?;
    let recipient: Mailbox = request
        .group
        .recipient
        .parse()
        .map_err(|_| "Email DVVC không hợp lệ.".to_string())?;
    let smtp_port = std::env::var("SMTP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(587);
    let subject = format!(
        "[{}] Yêu cầu hỗ trợ các đơn chưa được lấy ngày {}",
        request.group.reference_code,
        Local::now().format("%d/%m/%Y")
    );
    let body = mail_body(&request);
    let idempotency_key = format!("{}:{}", COMPLAINT_TYPE, request.group.reference_code);
    let local = storage::local_pool(&app).await?;

    if let Some((id, status)) = sqlx::query_as::<_, (String, String)>(
        "SELECT id, status FROM complaint_batches WHERE idempotency_key = ?",
    )
    .bind(&idempotency_key)
    .fetch_optional(&local)
    .await
    .map_err(|error| error.to_string())?
    {
        if status == "sent" {
            return Ok(SendComplaintResult {
                batch_id: id,
                status,
                reference_code: request.group.reference_code,
                sent_count: request.group.orders.len(),
                message: "Khiếu nại này đã được gửi trước đó; hệ thống không gửi lại.".into(),
            });
        }
        return Err(format!(
            "Khiếu nại đã được giữ với trạng thái {status}; không tự động gửi lại để tránh trùng."
        ));
    }

    let existing_complaints = storage::complaint_keys(&local).await?;
    if request.group.orders.iter().any(|order| {
        order
            .complaint_keys()
            .iter()
            .any(|key| existing_complaints.contains(key))
    }) {
        return Err("Đã dừng gửi: có vận đơn từng được khiếu nại trước đó.".into());
    }

    let batch_id = Uuid::new_v4().to_string();
    let created_at = Local::now().to_rfc3339();
    let mut tx = local.begin().await.map_err(|error| error.to_string())?;
    sqlx::query(
        r#"INSERT INTO complaint_batches
           (id, idempotency_key, carrier_code, carrier_name, reference_code, channel, recipient, subject, body, status, order_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', ?, ?)"#,
    )
    .bind(&batch_id).bind(&idempotency_key).bind(&request.group.carrier_code).bind(&request.group.carrier_name)
    .bind(&request.group.reference_code).bind(&request.group.channel).bind(&request.group.recipient)
    .bind(&subject).bind(&body).bind(request.group.orders.len() as i64).bind(&created_at)
    .execute(&mut *tx).await.map_err(|error| format!("Không thể khóa lô khiếu nại: {error}"))?;
    for order in &request.group.orders {
        sqlx::query(
            "INSERT INTO complaint_orders (batch_id, platform, order_id, tracking_number, complaint_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&batch_id).bind(&order.platform).bind(&order.order_id).bind(&order.tracking_number).bind(COMPLAINT_TYPE).bind(&created_at)
        .execute(&mut *tx).await.map_err(|_| "Có đơn đã được một tiến trình khác giữ để khiếu nại; đã dừng gửi.".to_string())?;
    }
    tx.commit().await.map_err(|error| error.to_string())?;

    let email = Message::builder()
        .from(from)
        .to(recipient)
        .subject(&subject)
        .body(body)
        .map_err(|error| error.to_string())?;
    let credentials = Credentials::new(smtp_username, smtp_password);
    let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp_host)
        .map_err(|error| format!("Cấu hình SMTP không hợp lệ: {error}"))?
        .port(smtp_port)
        .credentials(credentials)
        .build();

    match mailer.send(email).await {
        Ok(_) => {
            let sent_at = Local::now().to_rfc3339();
            sqlx::query("UPDATE complaint_batches SET status = 'sent', sent_at = ? WHERE id = ?")
                .bind(&sent_at)
                .bind(&batch_id)
                .execute(&local)
                .await
                .map_err(|error| error.to_string())?;
            Ok(SendComplaintResult {
                batch_id,
                status: "sent".into(),
                reference_code: request.group.reference_code,
                sent_count: request.group.orders.len(),
                message: "Đã gửi khiếu nại và khóa các vận đơn để chống gửi trùng.".into(),
            })
        }
        Err(error) => {
            sqlx::query(
                "UPDATE complaint_batches SET status = 'unknown_result', error = ? WHERE id = ?",
            )
            .bind(error.to_string())
            .bind(&batch_id)
            .execute(&local)
            .await
            .map_err(|db_error| db_error.to_string())?;
            Err("SMTP không xác nhận kết quả. Lô đã được khóa ở trạng thái chưa xác định và sẽ không tự gửi lại để tránh trùng.".into())
        }
    }
}

#[tauri::command]
pub async fn get_complaint_history(app: AppHandle) -> Result<Vec<ComplaintHistoryRow>, String> {
    let pool = storage::local_pool(&app).await?;
    storage::history(&pool).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order(id: &str) -> ImportedOrder {
        ImportedOrder {
            order_id: id.into(),
            tracking_number: format!("SPX{id}"),
            platform: "Shopee".into(),
            carrier_code: "SPX".into(),
            carrier_name: "SPX Express".into(),
            source_file: "x.xlsx".into(),
        }
    }

    #[test]
    fn excludes_picked_and_duplicate_complaints() {
        let existing = HashSet::from(["a".to_string()]);
        let complaints = HashSet::from(["tracking:spxb".to_string()]);
        let (eligible, excluded) = reconcile(
            vec![order("A"), order("B"), order("C")],
            &existing,
            &complaints,
            true,
        );
        assert_eq!(eligible.len(), 1);
        assert_eq!(excluded.len(), 2);
    }

    #[test]
    fn blocks_all_automatic_candidates_without_database() {
        let (eligible, excluded) =
            reconcile(vec![order("A")], &HashSet::new(), &HashSet::new(), false);
        assert!(eligible.is_empty());
        assert_eq!(excluded[0].reason_code, "NEEDS_REVIEW");
    }
}
