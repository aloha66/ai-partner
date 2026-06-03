use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct M0WindowSpikeStatus {
    transparent: &'static str,
    frameless: &'static str,
    always_on_top: &'static str,
    focus_policy: &'static str,
    spaces: &'static str,
    click_through_recovery: &'static str,
}

#[tauri::command]
fn m0_window_spike_status() -> M0WindowSpikeStatus {
    M0WindowSpikeStatus {
        transparent: "configured",
        frameless: "configured",
        always_on_top: "configured",
        focus_policy: "accessory",
        spaces: "normal only",
        click_through_recovery: "backend auto restore",
    }
}

#[tauri::command]
fn enter_click_through_for_ms(window: tauri::Window, duration_ms: u64) -> Result<(), String> {
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;

    let recovery_window = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(duration_ms));
        let _ = recovery_window.set_ignore_cursor_events(false);
        let _ = recovery_window.set_focusable(false);
        let _ = recovery_window.set_always_on_top(true);
        let _ = recovery_window.show();
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            m0_window_spike_status,
            enter_click_through_for_ms
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            app.handle()
                .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running ai-partner");
}
