use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const WORKFLOW_EVENT_SCHEMA_VERSION: &str = "ai-partner.workflow-event.v1";
pub const PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION: &str = "ai-partner.partner-state-snapshot.v1";
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

#[derive(Clone, Debug, Deserialize, Hash, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkflowSource {
    Cli,
    CodexWrapper,
    DemoScript,
    ClaudeHook,
    CodexHook,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorizationKind {
    Command,
    Tool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorizationStatus {
    Pending,
    Allowed,
    Denied,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkflowAuthorization {
    pub kind: AuthorizationKind,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub description: String,
    pub status: AuthorizationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
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
    pub card_title: Option<String>,
    pub context_path: Option<String>,
    pub authorization: Option<WorkflowAuthorization>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization: Option<WorkflowAuthorization>,
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
    retired_runs: HashSet<WorkflowRunIdentity>,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct WorkflowRunIdentity {
    source: WorkflowSource,
    run_id: String,
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
                retired_runs: HashSet::new(),
            })),
            done_idle_after,
        }
    }

    pub fn done_idle_after(&self) -> Duration {
        self.done_idle_after
    }

    pub fn current_snapshot(&self) -> PartnerStateSnapshot {
        self.inner
            .lock()
            .expect("state mutex poisoned")
            .snapshot
            .clone()
    }

    pub fn apply_workflow_event(
        &self,
        event: WorkflowEventWire,
    ) -> Result<StateTransition, String> {
        event.validate()?;

        let mut inner = self.inner.lock().expect("state mutex poisoned");
        if !should_accept_event(&inner.snapshot, &inner.retired_runs, &event) {
            return Ok(StateTransition {
                snapshot: inner.snapshot.clone(),
                should_emit: false,
                done_idle_timer: None,
            });
        }

        inner.generation += 1;
        let paused = inner.snapshot.paused;
        let previous_active_run = WorkflowRunIdentity::from_snapshot(&inner.snapshot);
        let event_run = WorkflowRunIdentity::from_event(&event);
        let snapshot = if event.workflow_state == WorkflowState::Idle {
            let mut idle = PartnerStateSnapshot::idle(&event.timestamp);
            idle.paused = paused;
            inner.retired_runs.insert(event_run);
            idle
        } else {
            if event.workflow_state.is_active_phase() {
                if let Some(previous_run) = previous_active_run {
                    if previous_run != event_run {
                        // V1 exposes one active card, not a multi-card queue. Once a run is
                        // preempted, later events for that same run are expired for this app
                        // session and must use a new run_id to surface again.
                        inner.retired_runs.insert(previous_run);
                    }
                }
                inner.retired_runs.remove(&event_run);
            }
            PartnerStateSnapshot {
                schema_version: PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION.to_string(),
                workflow_state: event.workflow_state.clone(),
                run_id: Some(event.run_id.clone()),
                active_run_id: next_active_run_id(&inner.snapshot, &event),
                source: Some(event.source.clone()),
                message: event.message.clone(),
                card_title: event.card_title.clone(),
                context_path: event.context_path.clone(),
                authorization: event.authorization.clone(),
                priority: priority_for(&event.workflow_state),
                updated_at: event.timestamp.clone(),
                paused,
                connection: ConnectionState::Ok,
            }
        };

        let done_idle_timer = if snapshot.workflow_state == WorkflowState::Done {
            snapshot
                .active_run_id
                .clone()
                .map(|active_run_id| DoneIdleTimer {
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
        inner.snapshot.paused = true;

        StateTransition {
            snapshot: inner.snapshot.clone(),
            should_emit: false,
            done_idle_timer: None,
        }
    }

    pub fn resume(&self) -> StateTransition {
        let mut inner = self.inner.lock().expect("state mutex poisoned");
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
        if let Some(active_run) = WorkflowRunIdentity::from_snapshot(&inner.snapshot) {
            inner.retired_runs.insert(active_run);
        }
        inner.snapshot = PartnerStateSnapshot::idle(&updated_at);
        inner.snapshot.paused = paused;

        StateTransition {
            snapshot: inner.snapshot.clone(),
            should_emit: !paused,
            done_idle_timer: None,
        }
    }

    pub fn complete_done_idle_timer(&self, timer: DoneIdleTimer) -> Option<PartnerStateSnapshot> {
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
        if let Some(active_run) = WorkflowRunIdentity::from_snapshot(&inner.snapshot) {
            inner.retired_runs.insert(active_run);
        }
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
            card_title: None,
            context_path: None,
            authorization: None,
            priority: SnapshotPriority::Normal,
            updated_at: updated_at.to_string(),
            paused: false,
            connection: ConnectionState::Ok,
        }
    }
}

impl WorkflowState {
    fn is_active_phase(&self) -> bool {
        matches!(
            self,
            WorkflowState::Running
                | WorkflowState::Reading
                | WorkflowState::Editing
                | WorkflowState::Waiting
        )
    }
}

impl WorkflowRunIdentity {
    fn from_event(event: &WorkflowEventWire) -> Self {
        Self {
            source: event.source.clone(),
            run_id: event.run_id.clone(),
        }
    }

    fn from_snapshot(snapshot: &PartnerStateSnapshot) -> Option<Self> {
        Some(Self {
            source: snapshot.source.clone()?,
            run_id: snapshot.active_run_id.clone()?,
        })
    }
}

impl WorkflowEventWire {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.schema_version != WORKFLOW_EVENT_SCHEMA_VERSION {
            return Err("unsupported workflow event schemaVersion".to_string());
        }
        validate_contract_id(&self.event_id, "evt_", "event_id")?;
        validate_contract_id(&self.run_id, "run_", "run_id")?;
        parse_event_timestamp(&self.timestamp)?;
        if self.code_context_allowed {
            return Err("code_context_allowed must be false".to_string());
        }
        if let Some(message) = &self.message {
            validate_message_text(message, 160)?;
        }
        if let Some(card_title) = &self.card_title {
            validate_short_text(card_title, "card_title", 80)?;
        }
        if let Some(context_path) = &self.context_path {
            validate_short_text(context_path, "context_path", 240)?;
        }
        if let Some(authorization) = &self.authorization {
            authorization.validate()?;
        }
        Ok(())
    }
}

impl WorkflowAuthorization {
    fn validate(&self) -> Result<(), String> {
        validate_contract_id(&self.id, "auth_", "authorization.id")?;
        if let Some(title) = &self.title {
            validate_short_text(title, "authorization.title", 80)?;
        }
        validate_short_text(&self.description, "authorization.description", 160)?;
        if let Some(decided_at) = &self.decided_at {
            parse_event_timestamp(decided_at)?;
        }
        Ok(())
    }
}

fn validate_short_text(value: &str, field: &str, max_chars: usize) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    if value.chars().count() > max_chars {
        return Err(format!("{field} must be {max_chars} chars or fewer"));
    }
    if value.contains('\n') || value.contains('\r') {
        return Err(format!("{field} must not contain newlines"));
    }
    Ok(())
}

fn validate_message_text(value: &str, max_chars: usize) -> Result<(), String> {
    if value.chars().count() > max_chars {
        return Err(format!("message must be {max_chars} chars or fewer"));
    }
    if value.contains('\n') || value.contains('\r') {
        return Err("message must not contain newlines".to_string());
    }
    Ok(())
}

fn validate_contract_id(value: &str, prefix: &str, field: &str) -> Result<(), String> {
    if value.chars().count() > 120 {
        return Err(format!("{field} must be 120 chars or fewer"));
    }

    let suffix = value
        .strip_prefix(prefix)
        .ok_or_else(|| format!("{field} must start with {prefix}"))?;
    if suffix.is_empty() || !suffix.chars().all(is_contract_id_char) {
        return Err(format!(
            "{field} must contain only ASCII letters, numbers, '.', '_', ':', or '-' after {prefix}"
        ));
    }

    Ok(())
}

fn is_contract_id_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | ':' | '-')
}

fn parse_event_timestamp(value: &str) -> Result<DateTime<FixedOffset>, String> {
    DateTime::parse_from_rfc3339(value)
        .map_err(|_| "timestamp must be RFC3339 date-time".to_string())
}

fn should_accept_event(
    snapshot: &PartnerStateSnapshot,
    retired_runs: &HashSet<WorkflowRunIdentity>,
    event: &WorkflowEventWire,
) -> bool {
    if event_is_older_than_snapshot(snapshot, event) {
        return false;
    }

    let event_run = WorkflowRunIdentity::from_event(event);
    let active_run = WorkflowRunIdentity::from_snapshot(snapshot);
    if retired_runs.contains(&event_run) && active_run.as_ref() != Some(&event_run) {
        return false;
    }

    match event.workflow_state {
        WorkflowState::Running
        | WorkflowState::Reading
        | WorkflowState::Editing
        | WorkflowState::Waiting => true,
        WorkflowState::Done | WorkflowState::Error | WorkflowState::Idle => {
            active_run.is_none() || active_run.as_ref() == Some(&event_run)
        }
    }
}

fn event_is_older_than_snapshot(
    snapshot: &PartnerStateSnapshot,
    event: &WorkflowEventWire,
) -> bool {
    let Ok(event_timestamp) = parse_event_timestamp(&event.timestamp) else {
        return true;
    };
    let Ok(snapshot_timestamp) = parse_event_timestamp(&snapshot.updated_at) else {
        return false;
    };

    event_timestamp < snapshot_timestamp
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
            card_title: None,
            context_path: None,
            authorization: None,
            code_context_allowed: false,
        }
    }

    fn assert_event_rejected(event: WorkflowEventWire, expected: &str) {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let error = store
            .apply_workflow_event(event)
            .expect_err("event should be rejected");
        assert!(
            error.contains(expected),
            "expected {error:?} to contain {expected:?}"
        );
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
        assert_eq!(
            transition.snapshot.active_run_id.as_deref(),
            Some("run_alpha")
        );
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
        assert_eq!(
            transition.snapshot.active_run_id.as_deref(),
            Some("run_new")
        );
    }

    #[test]
    fn old_error_does_not_override_new_active_run() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        store
            .apply_workflow_event(event("run_old", WorkflowState::Reading))
            .expect("old run should start");
        store
            .apply_workflow_event(event("run_new", WorkflowState::Editing))
            .expect("new run should become active");

        let transition = store
            .apply_workflow_event(event("run_old", WorkflowState::Error))
            .expect("stale error should be ignored");

        assert!(!transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Editing);
        assert_eq!(
            transition.snapshot.active_run_id.as_deref(),
            Some("run_new")
        );
    }

    #[test]
    fn active_done_keeps_run_until_timer_clears_to_idle() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        store
            .apply_workflow_event(event("run_alpha", WorkflowState::Reading))
            .expect("run should start");

        let transition = store
            .apply_workflow_event(event("run_alpha", WorkflowState::Done))
            .expect("done should apply");

        assert!(transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Done);
        assert_eq!(transition.snapshot.run_id.as_deref(), Some("run_alpha"));
        assert_eq!(
            transition.snapshot.active_run_id.as_deref(),
            Some("run_alpha")
        );
        assert!(transition.done_idle_timer.is_some());
    }

    #[test]
    fn active_idle_event_clears_run_to_idle() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        store
            .apply_workflow_event(event("run_alpha", WorkflowState::Reading))
            .expect("run should start");

        let transition = store
            .apply_workflow_event(event("run_alpha", WorkflowState::Idle))
            .expect("idle should apply for active run");

        assert!(transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Idle);
        assert_eq!(transition.snapshot.run_id, None);
        assert_eq!(transition.snapshot.active_run_id, None);
        assert_eq!(transition.snapshot.source, None);
        assert_eq!(transition.snapshot.message, None);
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
    fn clear_error_is_suppressed_while_paused_but_keeps_paused_idle() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        store.pause();
        store
            .apply_workflow_event(event("run_alpha", WorkflowState::Error))
            .expect("error should apply while paused");

        let transition = store.clear_error();

        assert!(!transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Idle);
        assert!(transition.snapshot.paused);
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

        let snapshot =
            store.complete_done_idle_timer(transition.done_idle_timer.expect("timer expected"));

        assert_eq!(snapshot, None);
        assert_eq!(
            store.current_snapshot().active_run_id.as_deref(),
            Some("run_beta")
        );
    }

    #[test]
    fn done_timer_continues_while_paused() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let transition = store
            .apply_workflow_event(event("run_alpha", WorkflowState::Done))
            .expect("done should apply");

        store.pause();
        let emitted =
            store.complete_done_idle_timer(transition.done_idle_timer.expect("timer expected"));

        assert_eq!(emitted, None);
        let paused_idle = store.current_snapshot();
        assert_eq!(paused_idle.workflow_state, WorkflowState::Idle);
        assert!(paused_idle.paused);
        assert_eq!(paused_idle.active_run_id, None);

        let resumed = store.resume();
        assert!(!resumed.should_emit);
        assert_eq!(resumed.snapshot.workflow_state, WorkflowState::Idle);
        assert!(!resumed.snapshot.paused);
    }

    #[test]
    fn stale_timestamp_event_does_not_roll_back_active_run() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let mut current = event("run_alpha", WorkflowState::Editing);
        current.timestamp = "2026-06-03T00:00:10Z".to_string();
        store
            .apply_workflow_event(current)
            .expect("current event should apply");

        let mut stale = event("run_alpha", WorkflowState::Reading);
        stale.timestamp = "2026-06-03T00:00:09Z".to_string();
        let transition = store
            .apply_workflow_event(stale)
            .expect("stale event should be ignored");

        assert!(!transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Editing);
        assert_eq!(transition.snapshot.updated_at, "2026-06-03T00:00:10Z");
    }

    #[test]
    fn stale_running_event_does_not_reclaim_active_run() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let mut old_run = event("run_old", WorkflowState::Reading);
        old_run.timestamp = "2026-06-03T00:00:00Z".to_string();
        store
            .apply_workflow_event(old_run)
            .expect("old run should start");

        let mut new_run = event("run_new", WorkflowState::Editing);
        new_run.timestamp = "2026-06-03T00:00:10Z".to_string();
        store
            .apply_workflow_event(new_run)
            .expect("new run should become active");

        let mut stale_old_run = event("run_old", WorkflowState::Running);
        stale_old_run.timestamp = "2026-06-03T00:00:05Z".to_string();
        let transition = store
            .apply_workflow_event(stale_old_run)
            .expect("stale old run should be ignored");

        assert!(!transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Editing);
        assert_eq!(
            transition.snapshot.active_run_id.as_deref(),
            Some("run_new")
        );
    }

    #[test]
    fn preempted_run_cannot_reclaim_single_active_card_with_newer_event() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let mut old_run = event("run_old", WorkflowState::Waiting);
        old_run.timestamp = "2026-06-03T00:00:00Z".to_string();
        store
            .apply_workflow_event(old_run)
            .expect("old run should start");

        let mut new_run = event("run_new", WorkflowState::Editing);
        new_run.timestamp = "2026-06-03T00:00:10Z".to_string();
        store
            .apply_workflow_event(new_run)
            .expect("new run should preempt old run");

        let mut late_old_run = event("run_old", WorkflowState::Waiting);
        late_old_run.timestamp = "2026-06-03T00:00:11Z".to_string();
        late_old_run.message = Some("late authorization should not surface".to_string());
        let transition = store
            .apply_workflow_event(late_old_run)
            .expect("preempted run should expire instead of queuing");

        assert!(!transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Editing);
        assert_eq!(
            transition.snapshot.active_run_id.as_deref(),
            Some("run_new")
        );
        assert_eq!(transition.snapshot.message.as_deref(), Some("working"));
    }

    #[test]
    fn completed_run_cannot_reappear_after_timer_clears_card_to_idle() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let mut done = event("run_done", WorkflowState::Done);
        done.timestamp = "2026-06-03T00:00:00Z".to_string();
        let transition = store
            .apply_workflow_event(done)
            .expect("done run should apply");
        store
            .complete_done_idle_timer(transition.done_idle_timer.expect("timer expected"))
            .expect("done timer should clear to idle");

        let mut resumed_old_run = event("run_done", WorkflowState::Running);
        resumed_old_run.timestamp = "2026-06-03T00:00:10Z".to_string();
        let transition = store
            .apply_workflow_event(resumed_old_run)
            .expect("completed run should stay expired");

        assert!(!transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Idle);
        assert_eq!(transition.snapshot.active_run_id, None);
    }

    #[test]
    fn same_run_id_from_different_sources_is_a_distinct_active_workflow() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let mut demo_run = event("run_shared", WorkflowState::Reading);
        demo_run.source = WorkflowSource::DemoScript;
        demo_run.timestamp = "2026-06-03T00:00:00Z".to_string();
        store
            .apply_workflow_event(demo_run)
            .expect("demo run should start");

        let mut claude_run = event("run_shared", WorkflowState::Waiting);
        claude_run.source = WorkflowSource::ClaudeHook;
        claude_run.timestamp = "2026-06-03T00:00:10Z".to_string();
        let transition = store
            .apply_workflow_event(claude_run)
            .expect("same run id from another source should be a distinct active run");

        assert!(transition.should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Waiting);
        assert_eq!(transition.snapshot.source, Some(WorkflowSource::ClaudeHook));
        assert_eq!(
            transition.snapshot.active_run_id.as_deref(),
            Some("run_shared")
        );

        let mut late_demo_run = event("run_shared", WorkflowState::Running);
        late_demo_run.source = WorkflowSource::DemoScript;
        late_demo_run.timestamp = "2026-06-03T00:00:11Z".to_string();
        let transition = store
            .apply_workflow_event(late_demo_run)
            .expect("preempted source/run pair should stay expired");

        assert!(!transition.should_emit);
        assert_eq!(transition.snapshot.source, Some(WorkflowSource::ClaudeHook));
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Waiting);
    }

    #[test]
    fn rejects_code_context_and_newline_messages() {
        let mut code_event = event("run_alpha", WorkflowState::Reading);
        code_event.code_context_allowed = true;
        assert_event_rejected(code_event, "code_context_allowed");

        let mut newline_event = event("run_beta", WorkflowState::Reading);
        newline_event.message = Some("line one\nline two".to_string());
        assert_event_rejected(newline_event, "newlines");
    }

    #[test]
    fn accepts_empty_message_for_v1_compatibility() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let mut empty_message = event("run_empty_message", WorkflowState::Reading);
        empty_message.message = Some(String::new());

        let transition = store
            .apply_workflow_event(empty_message)
            .expect("empty message is schema-valid v1 payload");

        assert_eq!(transition.snapshot.message.as_deref(), Some(""));
    }

    #[test]
    fn rejects_bad_schema_version_and_contract_ids() {
        let mut bad_version = event("run_alpha", WorkflowState::Reading);
        bad_version.schema_version = "ai-partner.workflow-event.v2".to_string();
        assert_event_rejected(bad_version, "schemaVersion");

        let mut bad_event_id = event("run_alpha", WorkflowState::Reading);
        bad_event_id.event_id = "bad_run_alpha".to_string();
        assert_event_rejected(bad_event_id, "event_id");

        let mut bad_run_id = event("run_alpha", WorkflowState::Reading);
        bad_run_id.run_id = "run_alpha/secret".to_string();
        assert_event_rejected(bad_run_id, "run_id");

        let mut too_long_event_id = event("run_alpha", WorkflowState::Reading);
        too_long_event_id.event_id = format!("evt_{}", "a".repeat(117));
        assert_event_rejected(too_long_event_id, "120 chars");

        let mut bad_timestamp = event("run_alpha", WorkflowState::Reading);
        bad_timestamp.timestamp = "not-a-date".to_string();
        assert_event_rejected(bad_timestamp, "timestamp");
    }

    #[test]
    fn rejects_message_over_160_chars() {
        let mut long_message = event("run_alpha", WorkflowState::Waiting);
        long_message.message = Some("a".repeat(161));

        assert_event_rejected(long_message, "160 chars");
    }

    #[test]
    fn rejects_unknown_authorization_fields() {
        let raw = serde_json::json!({
            "schemaVersion": WORKFLOW_EVENT_SCHEMA_VERSION,
            "event_id": "evt_auth_unknown",
            "source": "claude-hook",
            "run_id": "run_auth_unknown",
            "workflow_state": "waiting",
            "timestamp": "2026-06-03T00:00:00Z",
            "authorization": {
                "kind": "command",
                "id": "auth_unknown",
                "description": "git status",
                "status": "pending",
                "token": "secret"
            },
            "code_context_allowed": false
        });

        assert!(
            serde_json::from_value::<WorkflowEventWire>(raw).is_err(),
            "authorization extras must not be silently dropped"
        );
    }
}
