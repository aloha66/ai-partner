use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const CONTRACTS_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../packages/contracts");

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
struct WorkflowEventWire {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    event_id: String,
    source: WorkflowSource,
    run_id: String,
    workflow_state: WorkflowState,
    timestamp: String,
    message: Option<String>,
    code_context_allowed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum WorkflowSource {
    Cli,
    CodexWrapper,
    DemoScript,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WorkflowState {
    Idle,
    Running,
    Reading,
    Editing,
    Waiting,
    Error,
    Done,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[allow(dead_code)]
struct PartnerStateSnapshot {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    workflow_state: WorkflowState,
    run_id: Option<String>,
    active_run_id: Option<String>,
    source: Option<WorkflowSource>,
    message: Option<String>,
    priority: SnapshotPriority,
    updated_at: String,
    paused: bool,
    connection: ConnectionState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SnapshotPriority {
    Normal,
    High,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ConnectionState {
    Ok,
    Degraded,
    Disconnected,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[allow(dead_code)]
struct RuntimeDescriptor {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    app_instance_id: String,
    pid: u32,
    port: u16,
    token: String,
    created_at: String,
}

fn read_json(path: &Path) -> Value {
    let raw = fs::read_to_string(path).expect("fixture should be readable");
    serde_json::from_str(&raw).expect("fixture should be valid JSON")
}

fn fixture_paths(kind: &str) -> Vec<PathBuf> {
    let mut paths = fs::read_dir(Path::new(CONTRACTS_ROOT).join("fixtures").join(kind))
        .expect("fixture directory should exist")
        .map(|entry| entry.expect("fixture entry should be readable").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect::<Vec<_>>();

    paths.sort();
    paths
}

fn schema_path_for_fixture(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .expect("fixture should have a file name")
        .to_string_lossy();

    let schema_name = if file_name.starts_with("workflow-event") {
        "workflow-event.schema.json"
    } else if file_name.starts_with("partner-state-snapshot") {
        "partner-state-snapshot.schema.json"
    } else if file_name.starts_with("animation-intent") {
        "animation-intent.schema.json"
    } else if file_name.starts_with("runtime-descriptor") {
        "runtime-descriptor.schema.json"
    } else {
        panic!("No schema mapping for fixture {file_name}");
    };

    Path::new(CONTRACTS_ROOT).join("schema").join(schema_name)
}

fn assert_schema_validity(path: &Path, expected_valid: bool) {
    let schema = read_json(&schema_path_for_fixture(path));
    let instance = read_json(path);
    let validator = jsonschema::validator_for(&schema).expect("schema should compile");
    assert_eq!(
        validator.is_valid(&instance),
        expected_valid,
        "unexpected schema result for {}",
        path.display()
    );
}

#[test]
fn rust_consumes_all_valid_json_schema_fixtures() {
    for path in fixture_paths("valid") {
        assert_schema_validity(&path, true);
    }
}

#[test]
fn rust_rejects_invalid_json_schema_fixtures() {
    for path in fixture_paths("invalid") {
        assert_schema_validity(&path, false);
    }
}

#[test]
fn rust_deserializes_representative_contract_fixtures() {
    let workflow_event: WorkflowEventWire = serde_json::from_value(read_json(
        &Path::new(CONTRACTS_ROOT).join("fixtures/valid/workflow-event-reading.json"),
    ))
    .expect("valid workflow event should deserialize");
    assert_eq!(
        workflow_event.schema_version,
        "ai-partner.workflow-event.v1"
    );
    assert!(!workflow_event.code_context_allowed);

    let snapshot: PartnerStateSnapshot = serde_json::from_value(read_json(
        &Path::new(CONTRACTS_ROOT).join("fixtures/valid/partner-state-snapshot-reading.json"),
    ))
    .expect("valid snapshot should deserialize");
    assert_eq!(
        snapshot.schema_version,
        "ai-partner.partner-state-snapshot.v1"
    );

    let descriptor: RuntimeDescriptor = serde_json::from_value(read_json(
        &Path::new(CONTRACTS_ROOT).join("fixtures/valid/runtime-descriptor.json"),
    ))
    .expect("valid runtime descriptor should deserialize");
    assert_eq!(
        descriptor.schema_version,
        "ai-partner.runtime-descriptor.v1"
    );
    assert!(descriptor.port > 0);
}
