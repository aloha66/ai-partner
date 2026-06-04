use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

mod ingress;
mod state;

use state::{
    PartnerStateSnapshot, PartnerStateStore, WorkflowEventWire, PARTNER_STATE_CHANGED_EVENT,
};

const CLICK_THROUGH_RESTORED_EVENT: &str = "click-through-restored";

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
        .set_focusable(false)
        .map_err(|error| error.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
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
        let _ = recovery_window.emit(CLICK_THROUGH_RESTORED_EVENT, ());
    });

    Ok(())
}

#[tauri::command]
fn get_current_state(store: State<'_, PartnerStateStore>) -> PartnerStateSnapshot {
    store.current_snapshot()
}

#[tauri::command]
fn apply_workflow_event(
    app: AppHandle,
    store: State<'_, PartnerStateStore>,
    event: WorkflowEventWire,
) -> Result<PartnerStateSnapshot, String> {
    let transition = store.apply_workflow_event(event)?;
    emit_state_transition(&app, &store, &transition);
    Ok(transition.snapshot)
}

#[tauri::command]
fn pause(store: State<'_, PartnerStateStore>) -> PartnerStateSnapshot {
    store.pause().snapshot
}

#[tauri::command]
fn resume(store: State<'_, PartnerStateStore>) -> PartnerStateSnapshot {
    store.resume().snapshot
}

#[tauri::command]
fn clear_error(app: AppHandle, store: State<'_, PartnerStateStore>) -> PartnerStateSnapshot {
    let transition = store.clear_error();
    emit_state_transition(&app, &store, &transition);
    transition.snapshot
}

fn emit_state_transition(
    app: &AppHandle,
    store: &PartnerStateStore,
    transition: &state::StateTransition,
) {
    publish_state_transition(
        app,
        store,
        transition,
        transition.should_emit,
        transition.should_emit,
    );
}

pub(crate) fn publish_state_transition(
    app: &AppHandle,
    store: &PartnerStateStore,
    transition: &state::StateTransition,
    should_emit: bool,
    should_emit_timer: bool,
) {
    if should_emit {
        let _ = app.emit(PARTNER_STATE_CHANGED_EVENT, transition.snapshot.clone());
    }

    if let Some(timer) = transition.done_idle_timer.clone() {
        let store = store.clone();
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(store.done_idle_after());
            if let Some(snapshot) = store.complete_done_idle_timer(timer) {
                if should_emit_timer {
                    let _ = app.emit(PARTNER_STATE_CHANGED_EVENT, snapshot);
                }
            }
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(PartnerStateStore::default())
        .invoke_handler(tauri::generate_handler![
            m0_window_spike_status,
            enter_click_through_for_ms,
            get_current_state,
            apply_workflow_event,
            pause,
            resume,
            clear_error
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            app.handle()
                .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

            let store = app.state::<PartnerStateStore>().inner().clone();
            let ingress = ingress::start_local_ingress(app.handle().clone(), store)?;
            app.manage(ingress);

            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running ai-partner");
}
