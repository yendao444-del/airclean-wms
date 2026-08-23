use serde::{Deserialize, Serialize};

pub const COMPLAINT_TYPE: &str = "NO_PICKUP";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct ImportedOrder {
    pub order_id: String,
    pub tracking_number: String,
    pub platform: String,
    pub carrier_code: String,
    pub carrier_name: String,
    pub source_file: String,
}

impl ImportedOrder {
    pub fn key(&self) -> (String, String) {
        (
            self.platform.trim().to_lowercase(),
            self.order_id.trim().to_lowercase(),
        )
    }

    pub fn complaint_keys(&self) -> [String; 2] {
        [
            format!(
                "order:{}:{}",
                self.platform.trim().to_lowercase(),
                self.order_id.trim().to_lowercase()
            ),
            format!("tracking:{}", self.tracking_number.trim().to_lowercase()),
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CarrierGroup {
    pub carrier_code: String,
    pub carrier_name: String,
    pub channel: String,
    pub recipient: String,
    pub reference_code: String,
    pub shopee_count: usize,
    pub tiktok_count: usize,
    pub orders: Vec<ImportedOrder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedOrder {
    pub order: ImportedOrder,
    pub reason: String,
    pub reason_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub session_id: String,
    pub imported_at: String,
    pub file_count: usize,
    pub parsed_count: usize,
    pub eligible_count: usize,
    pub existing_order_count: usize,
    pub duplicate_complaint_count: usize,
    pub needs_review_count: usize,
    pub database_connected: bool,
    pub groups: Vec<CarrierGroup>,
    pub excluded: Vec<ExcludedOrder>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendComplaintRequest {
    pub group: CarrierGroup,
    pub warehouse: String,
    pub cutoff: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendComplaintResult {
    pub batch_id: String,
    pub status: String,
    pub reference_code: String,
    pub sent_count: usize,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub database_configured: bool,
    pub smtp_configured: bool,
    pub safe_to_send: bool,
    pub mode_label: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ComplaintHistoryRow {
    pub id: String,
    pub carrier_name: String,
    pub reference_code: String,
    pub status: String,
    pub order_count: i64,
    pub created_at: String,
    pub sent_at: Option<String>,
}
