use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const WORKFLOW_EVENT_SCHEMA_VERSION: &str = "ai-partner.workflow-event.v1";
pub const PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION: &str =
    "ai-partner.partner-state-snapshot.v1";
pub const PARTNER_STATE_CHANGED_EVENT: &str = "partner-state-changed";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowState {
    Idle,
    Running,
    Reading,
    Editing,
    Waiting,
    Error,
    Done,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkflowSource {
    Cli,
    CodexWrapper,
    DemoScript,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkflowEventWire {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    pub event_id: String,
    pub source: WorkflowSource,
    pub run_id: String,
    pub workflow_state: WorkflowState,
    pub timestamp: String,
    pub message: Option<String>,
    pub code_context_allowed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotPriority {
    Normal,
    High,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)]
pub enum ConnectionState {
    Ok,
    Degraded,
    Disconnected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartnerStateSnapshot {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    pub workflow_state: WorkflowState,
    pub run_id: Option<String>,
    pub active_run_id: Option<String>,
    pub source: Option<WorkflowSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub priority: SnapshotPriority,
    pub updated_at: String,
    pub paused: bool,
    pub connection: ConnectionState,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DoneIdleTimer {
    generation: u64,
    active_run_id: String,
}

#[derive(Clone, Debug)]
pub struct StateTransition {
    pub snapshot: PartnerStateSnapshot,
    pub should_emit: bool,
    pub done_idle_timer: Option<DoneIdleTimer>,
}

#[derive(Clone)]
pub struct PartnerStateStore {
    inner: Arc<Mutex<PartnerStateStoreInner>>,
    done_idle_after: Duration,
}

#[derive(Clone, Debug)]
struct PartnerStateStoreInner {
    snapshot: PartnerStateSnapshot,
    generation: u64,
}

impl Default for PartnerStateStore {
    fn default() -> Self {
        Self::new(Duration::from_secs(3))
    }
}

impl PartnerStateStore {
    pub fn new(done_idle_after: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(PartnerStateStoreInner {
                snapshot: PartnerStateSnapshot::idle("1970-01-01T00:00:00Z"),
                generation: 0,
            })),
            done_idle_after,
        }
    }

    pub fn done_idle_after(&self) -> Duration {
        self.done_idle_after
    }

    pub fn current_snapshot(&self) -> PartnerStateSnapshot {
        self.inner.lock().expect("state mutex poisoned").snapshot.clone()
    }

    pub fn apply_workflow_event(
        &self,
        event: WorkflowEventWire,
    ) -> Result<StateTransition, String> {
        event.validate()?;

        let mut inner = self.inner.lock().expect("state mutex poisoned");
        if !should_accept_event(&inner.snapshot, &event) {
            return Ok(StateTransition {
                snapshot: inner.snapshot.clone(),
                should_emit: false,
                done_idle_timer: None,
            });
        }

        inner.generation += 1;
        let active_run_id = next_active_run_id(&inner.snapshot, &event);
        let snapshot = PartnerStateSnapshot {
            schema_version: PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION.to_string(),
            workflow_state: event.workflow_state.clone(),
            run_id: Some(event.run_id.clone()),
            active_run_id,
            source: Some(event.source.clone()),
            message: event.message.clone(),
            priority: priority_for(&event.workflow_state),
            updated_at: event.timestamp.clone(),
            paused: inner.snapshot.paused,
            connection: ConnectionState::Ok,
        };

        let done_idle_timer = if snapshot.workflow_state == WorkflowState::Done {
            snapshot.active_run_id.clone().map(|active_run_id| DoneIdleTimer {
                generation: inner.generation,
                active_run_id,
            })
        } else {
            None
        };
        inner.snapshot = snapshot.clone();

        Ok(StateTransition {
            snapshot,
            should_emit: !inner.snapshot.paused,
            done_idle_timer,
        })
    }

    pub fn pause(&self) -> StateTransition {
        let mut inner = self.inner.lock().expect("state mutex poisoned");
        inner.generation += 1;
        inner.snapshot.paused = true;

        StateTransition {
            snapshot: inner.snapshot.clone(),
            should_emit: false,
            done_idle_timer: None,
        }
    }

    pub fn resume(&self) -> StateTransition {
        let mut inner = self.inner.lock().expect("state mutex poisoned");
        inner.generation += 1;
        inner.snapshot.paused = false;

        StateTransition {
            snapshot: inner.snapshot.clone(),
            should_emit: false,
            done_idle_timer: None,
        }
    }

    pub fn clear_error(&self) -> StateTransition {
        let mut inner = self.inner.lock().expect("state mutex poisoned");
        if inner.snapshot.workflow_state != WorkflowState::Error {
            return StateTransition {
                snapshot: inner.snapshot.clone(),
                should_emit: false,
                done_idle_timer: None,
            };
        }

        inner.generation += 1;
        let paused = inner.snapshot.paused;
        let updated_at = inner.snapshot.updated_at.clone();
        inner.snapshot = PartnerStateSnapshot::idle(&updated_at);
        inner.snapshot.paused = paused;

        StateTransition {
            snapshot: inner.snapshot.clone(),
            should_emit: !paused,
            done_idle_timer: None,
        }
    }

    pub fn complete_done_idle_timer(
        &self,
        timer: DoneIdleTimer,
    ) -> Option<PartnerStateSnapshot> {
        let mut inner = self.inner.lock().expect("state mutex poisoned");
        if inner.generation != timer.generation
            || inner.snapshot.workflow_state != WorkflowState::Done
            || inner.snapshot.active_run_id.as_deref() != Some(timer.active_run_id.as_str())
        {
            return None;
        }

        inner.generation += 1;
        let paused = inner.snapshot.paused;
        let updated_at = inner.snapshot.updated_at.clone();
        inner.snapshot = PartnerStateSnapshot::idle(&updated_at);
        inner.snapshot.paused = paused;

        if paused {
            None
        } else {
            Some(inner.snapshot.clone())
        }
    }
}

impl PartnerStateSnapshot {
    fn idle(updated_at: &str) -> Self {
        Self {
            schema_version: PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION.to_string(),
            workflow_state: WorkflowState::Idle,
            run_id: None,
            active_run_id: None,
            source: None,
            message: None,
            priority: SnapshotPriority::Normal,
            updated_at: updated_at.to_string(),
            paused: false,
            connection: ConnectionState::Ok,
        }
    }
}

impl WorkflowEventWire {
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != WORKFLOW_EVENT_SCHEMA_VERSION {
            return Err("unsupported workflow event schemaVersion".to_string());
        }
        if !self.event_id.starts_with("evt_") {
            return Err("event_id must start with evt_".to_string());
        }
        if !self.run_id.starts_with("run_") {
            return Err("run_id must start with run_".to_string());
        }
        if self.code_context_allowed {
            return Err("code_context_allowed must be false".to_string());
        }
        if let Some(message) = &self.message {
            if message.chars().count() > 160 {
                return Err("message must be 160 chars or fewer".to_string());
            }
            if message.contains('\n') || message.contains('\r') {
                return Err("message must not contain newlines".to_string());
            }
        }
        Ok(())
    }
}

fn should_accept_event(snapshot: &PartnerStateSnapshot, event: &WorkflowEventWire) -> bool {
    match event.workflow_state {
        WorkflowState::Running
        | WorkflowState::Reading
        | WorkflowState::Editing
        | WorkflowState::Waiting => true,
        WorkflowState::Done | WorkflowState::Error | WorkflowState::Idle => {
            snapshot.active_run_id.as_deref().is_none()
                || snapshot.active_run_id.as_deref() == Some(event.run_id.as_str())
        }
    }
}

fn next_active_run_id(
    snapshot: &PartnerStateSnapshot,
    event: &WorkflowEventWire,
) -> Option<String> {
    match event.workflow_state {
        WorkflowState::Idle => None,
        WorkflowState::Running
        | WorkflowState::Reading
        | WorkflowState::Editing
        | WorkflowState::Waiting => Some(event.run_id.clone()),
        WorkflowState::Error | WorkflowState::Done => snapshot
            .active_run_id
            .clone()
            .or_else(|| Some(event.run_id.clone())),
    }
}

fn priority_for(workflow_state: &WorkflowState) -> SnapshotPriority {
    match workflow_state {
        WorkflowState::Waiting | WorkflowState::Error => SnapshotPriority::High,
        WorkflowState::Idle
        | WorkflowState::Running
        | WorkflowState::Reading
        | WorkflowState::Editing
        | WorkflowState::Done => SnapshotPriority::Normal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(run_id: &str, workflow_state: WorkflowState) -> WorkflowEventWire {
        WorkflowEventWire {
            schema_version: WORKFLOW_EVENT_SCHEMA_VERSION.to_string(),
            event_id: format!("evt_{run_id}"),
            source: WorkflowSource::DemoScript,
            run_id: run_id.to_string(),
            workflow_state,
            timestamp: "2026-06-03T00:00:00Z".to_string(),
            message: Some("working".to_string()),
            code_context_allowed: false,
        }
    }

    #[test]
    fn starts_with_idle_snapshot() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let snapshot = store.current_snapshot();
        assert_eq!(snapshot.workflow_state, WorkflowState::Idle);
        assert_eq!(snapshot.active_run_id, None);
        assert!(!snapshot.paused);
    }

    #[test]
    fn running_event_becomes_active_snapshot() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let transition = store
            .apply_workflow_event(event("run_alpha", WorkflowState::Reading))
            .expect("event should apply");

        assert!(transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Reading);
        assert_eq!(transition.snapshot.active_run_id.as_deref(), Some("run_alpha"));
        assert_eq!(transition.snapshot.priority, SnapshotPriority::Normal);
    }

    #[test]
    fn old_done_does_not_override_new_active_run() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        store
            .apply_workflow_event(event("run_old", WorkflowState::Reading))
            .expect("old run should start");
        store
            .apply_workflow_event(event("run_new", WorkflowState::Running))
            .expect("new run should become active");

        let transition = store
            .apply_workflow_event(event("run_old", WorkflowState::Done))
            .expect("stale done should be ignored");

        assert!(!transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Running);
        assert_eq!(transition.snapshot.active_run_id.as_deref(), Some("run_new"));
    }

    #[test]
    fn pause_keeps_latest_snapshot_but_suppresses_emit() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        store.pause();

        let transition = store
            .apply_workflow_event(event("run_alpha", WorkflowState::Waiting))
            .expect("event should apply while paused");

        assert!(!transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Waiting);
        assert!(transition.snapshot.paused);
        assert_eq!(transition.snapshot.priority, SnapshotPriority::High);
    }

    #[test]
    fn resume_returns_current_snapshot_without_replay_emit() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        store.pause();
        store
            .apply_workflow_event(event("run_alpha", WorkflowState::Waiting))
            .expect("event should apply while paused");

        let transition = store.resume();

        assert!(!transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Waiting);
        assert!(!transition.snapshot.paused);
    }

    #[test]
    fn clear_error_returns_to_idle() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        store
            .apply_workflow_event(event("run_alpha", WorkflowState::Error))
            .expect("error should apply");

        let transition = store.clear_error();

        assert!(transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Idle);
        assert_eq!(transition.snapshot.active_run_id, None);
    }

    #[test]
    fn done_timer_returns_active_done_to_idle() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let transition = store
            .apply_workflow_event(event("run_alpha", WorkflowState::Done))
            .expect("done should apply");

        let snapshot = store
            .complete_done_idle_timer(transition.done_idle_timer.expect("timer expected"))
            .expect("timer should emit idle");

        assert_eq!(snapshot.workflow_state, WorkflowState::Idle);
        assert_eq!(snapshot.active_run_id, None);
    }

    #[test]
    fn stale_done_timer_does_not_clear_new_active_run() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let transition = store
            .apply_workflow_event(event("run_alpha", WorkflowState::Done))
            .expect("done should apply");
        store
            .apply_workflow_event(event("run_beta", WorkflowState::Running))
            .expect("new run should replace done");

        let snapshot = store.complete_done_idle_timer(
            transition.done_idle_timer.expect("timer expected"),
        );

        assert_eq!(snapshot, None);
        assert_eq!(
            store.current_snapshot().active_run_id.as_deref(),
            Some("run_beta")
        );
    }

    #[test]
    fn rejects_code_context_and_newline_messages() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let mut code_event = event("run_alpha", WorkflowState::Reading);
        code_event.code_context_allowed = true;
        assert!(store.apply_workflow_event(code_event).is_err());

        let mut newline_event = event("run_beta", WorkflowState::Reading);
        newline_event.message = Some("line one\nline two".to_string());
        assert!(store.apply_workflow_event(newline_event).is_err());
    }
}
