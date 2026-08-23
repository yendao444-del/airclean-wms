use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use calamine::{open_workbook_auto, Data, Range, Reader};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

use crate::domain::ImportedOrder;

fn clean(value: impl AsRef<str>) -> String {
    value.as_ref().trim().trim_matches('\u{feff}').to_string()
}

fn normalized(value: impl AsRef<str>) -> String {
    value
        .as_ref()
        .replace('đ', "d")
        .replace('Đ', "D")
        .nfd()
        .filter(|ch| !is_combining_mark(*ch))
        .flat_map(char::to_lowercase)
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect()
}

fn header_index(headers: &[String], candidates: &[&str]) -> Option<usize> {
    let candidates: Vec<String> = candidates.iter().map(normalized).collect();
    headers
        .iter()
        .position(|header| candidates.contains(&normalized(header)))
}

fn carrier(raw: &str) -> (String, String) {
    let key = normalized(raw);
    if key.contains("spx") || key.contains("shopeeexpress") {
        ("SPX".into(), "SPX Express".into())
    } else if key.contains("jtexpress") || key == "jt" || key.contains("giaohangtietkiemjt") {
        ("JNT".into(), "J&T Express".into())
    } else if key.contains("ghn") || key.contains("giaohangnhanh") {
        ("GHN".into(), "GHN".into())
    } else if key.contains("viettel") || key.contains("vtp") {
        ("VTP".into(), "Viettel Post".into())
    } else if key.contains("vnpost") || key.contains("vietnampost") || key.contains("buudien") {
        ("VNPOST".into(), "Vietnam Post".into())
    } else if key.contains("best") {
        ("BEST".into(), "BEST Express".into())
    } else {
        ("UNKNOWN".into(), clean(raw))
    }
}

fn cell(row: &[String], index: Option<usize>, fallback: Option<usize>) -> String {
    index
        .or(fallback)
        .and_then(|i| row.get(i))
        .map(clean)
        .unwrap_or_default()
}

fn parse_rows(
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
    file_name: String,
) -> Vec<ImportedOrder> {
    let order_index = header_index(&headers, &["Order ID", "Mã đơn hàng", "Ma don hang"]);
    let tracking_index = header_index(
        &headers,
        &[
            "Tracking ID",
            "Tracking Number",
            "Mã vận đơn",
            "Ma van don",
            "Số vận đơn",
        ],
    );
    let carrier_index = header_index(
        &headers,
        &[
            "Shipping Provider Name",
            "Đơn vị vận chuyển",
            "Đơn Vị Vận Chuyển",
        ],
    );
    let is_tiktok = header_index(&headers, &["Order ID"]).is_some()
        && header_index(&headers, &["Tracking ID", "Tracking Number"]).is_some();
    let is_shopee = !is_tiktok && (order_index.is_some() || tracking_index.is_some());

    if !is_tiktok && !is_shopee {
        return Vec::new();
    }

    let platform = if is_tiktok { "TikTok Shop" } else { "Shopee" };
    let mut orders = HashMap::<String, ImportedOrder>::new();
    for row in rows {
        let order_id = cell(&row, order_index, if is_shopee { Some(0) } else { None });
        let tracking_number = cell(&row, tracking_index, if is_shopee { Some(7) } else { None });
        let carrier_raw = cell(&row, carrier_index, if is_shopee { Some(8) } else { None });
        if order_id.is_empty() || tracking_number.is_empty() {
            continue;
        }
        let (carrier_code, carrier_name) = carrier(&carrier_raw);
        orders.entry(order_id.clone()).or_insert(ImportedOrder {
            order_id,
            tracking_number,
            platform: platform.into(),
            carrier_code,
            carrier_name,
            source_file: file_name.clone(),
        });
    }
    orders.into_values().collect()
}

fn range_to_rows(range: Range<Data>) -> (Vec<String>, Vec<Vec<String>>) {
    let mut iter = range.rows();
    let headers = iter
        .next()
        .unwrap_or_default()
        .iter()
        .map(ToString::to_string)
        .collect();
    let rows = iter
        .map(|row| row.iter().map(ToString::to_string).collect())
        .collect();
    (headers, rows)
}

fn parse_excel(path: &Path) -> Result<Vec<ImportedOrder>, String> {
    let mut workbook = open_workbook_auto(path)
        .map_err(|error| format!("Không đọc được {}: {error}", path.display()))?;
    let range = workbook
        .worksheet_range_at(0)
        .ok_or_else(|| format!("{} không có sheet dữ liệu", path.display()))?
        .map_err(|error| format!("Không đọc được sheet {}: {error}", path.display()))?;
    let (headers, rows) = range_to_rows(range);
    Ok(parse_rows(
        headers,
        rows,
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
    ))
}

fn parse_csv(path: &Path) -> Result<Vec<ImportedOrder>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_path(path)
        .map_err(|error| format!("Không đọc được {}: {error}", path.display()))?;
    let headers: Vec<String> = reader
        .headers()
        .map_err(|error| format!("File CSV không có tiêu đề: {error}"))?
        .iter()
        .map(ToString::to_string)
        .collect();
    let rows = reader
        .records()
        .filter_map(Result::ok)
        .map(|record| record.iter().map(ToString::to_string).collect())
        .collect();
    Ok(parse_rows(
        headers,
        rows,
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
    ))
}

fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("xlsx" | "xls" | "csv")
    ) && !path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .starts_with("~$")
}

fn expand_paths(paths: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        if path.is_dir() {
            let entries = fs::read_dir(&path)
                .map_err(|error| format!("Không đọc được thư mục {}: {error}", path.display()))?;
            for entry in entries.flatten() {
                if supported(&entry.path()) {
                    files.push(entry.path());
                }
            }
        } else if path.is_file() && supported(&path) {
            files.push(path);
        }
    }
    files.sort();
    files.dedup();
    Ok(files)
}

pub fn parse_paths(paths: &[String]) -> Result<(Vec<ImportedOrder>, usize), String> {
    let files = expand_paths(paths)?;
    if files.is_empty() {
        return Err("Không tìm thấy file XLSX, XLS hoặc CSV hợp lệ.".into());
    }
    let mut unique = HashMap::<(String, String), ImportedOrder>::new();
    for path in &files {
        let parsed = if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_lowercase)
            .as_deref()
            == Some("csv")
        {
            parse_csv(path)?
        } else {
            parse_excel(path)?
        };
        for order in parsed {
            unique.entry(order.key()).or_insert(order);
        }
    }
    Ok((unique.into_values().collect(), files.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tiktok_headers_and_carrier() {
        let rows = vec![vec![
            "123456".into(),
            "JT00001".into(),
            "J&T Express Việt Nam".into(),
        ]];
        let parsed = parse_rows(
            vec![
                "Order ID".into(),
                "Tracking ID".into(),
                "Shipping Provider Name".into(),
            ],
            rows,
            "tiktok.csv".into(),
        );
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].platform, "TikTok Shop");
        assert_eq!(parsed[0].carrier_code, "JNT");
    }

    #[test]
    fn parses_vietnamese_shopee_headers() {
        let parsed = parse_rows(
            vec![
                "Mã đơn hàng".into(),
                "Mã vận đơn".into(),
                "Đơn vị vận chuyển".into(),
            ],
            vec![vec!["SHP01".into(), "SPXVN01".into(), "SPX Express".into()]],
            "shopee.xlsx".into(),
        );
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].carrier_code, "SPX");
    }
}
