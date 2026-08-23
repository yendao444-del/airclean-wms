mod commands;
mod domain;
mod parser;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_app_status,
            commands::import_order_files,
            commands::send_complaint,
            commands::get_complaint_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
