use crate::state::{
    PartnerStateSnapshot, PartnerStateStore, WorkflowEventWire, PARTNER_STATE_CHANGED_EVENT,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const RUNTIME_DESCRIPTOR_SCHEMA_VERSION: &str = "ai-partner.runtime-descriptor.v1";

const DESCRIPTOR_DIR_NAME: &str = "ai-partner";
const DESCRIPTOR_FILE_NAME: &str = "runtime-descriptor.json";
const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_PAYLOAD_BYTES: usize = 4 * 1024;
const DEDUPE_TTL: Duration = Duration::from_secs(10 * 60);
const DEDUPE_MAX_EVENTS: usize = 1024;
const PER_RUN_DEBOUNCE: Duration = Duration::from_millis(300);
const RATE_TOKENS_PER_SECOND: f64 = 10.0;
const RATE_BURST: f64 = 30.0;
const READ_TIMEOUT: Duration = Duration::from_secs(2);
const STALE_PORT_CHECK_TIMEOUT: Duration = Duration::from_millis(50);
const FORBIDDEN_FIELDS: &[&str] = &[
    "clipboard",
    "code",
    "diff",
    "fileContent",
    "file_content",
    "prompt",
    "screenText",
    "screen_text",
];
const ALLOWED_EVENT_FIELDS: &[&str] = &[
    "code_context_allowed",
    "event_id",
    "message",
    "run_id",
    "schemaVersion",
    "source",
    "timestamp",
    "workflow_state",
];

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDescriptor {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    pub app_instance_id: String,
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub created_at: String,
}

#[derive(Clone, Debug)]
struct IngressConfig {
    payload_limit: usize,
    dedupe_ttl: Duration,
    dedupe_max_events: usize,
    debounce: Duration,
    rate_tokens_per_second: f64,
    rate_burst: f64,
}

impl Default for IngressConfig {
    fn default() -> Self {
        Self {
            payload_limit: MAX_PAYLOAD_BYTES,
            dedupe_ttl: DEDUPE_TTL,
            dedupe_max_events: DEDUPE_MAX_EVENTS,
            debounce: PER_RUN_DEBOUNCE,
            rate_tokens_per_second: RATE_TOKENS_PER_SECOND,
            rate_burst: RATE_BURST,
        }
    }
}

#[derive(Debug)]
pub struct LocalIngress {
    descriptor_path: PathBuf,
    app_instance_id: String,
    shutdown: Arc<AtomicBool>,
    addr: SocketAddr,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl LocalIngress {
    #[allow(dead_code)]
    pub fn descriptor_path(&self) -> &Path {
        &self.descriptor_path
    }

    #[allow(dead_code)]
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }
}

impl Drop for LocalIngress {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);

        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }

        let _ = remove_runtime_descriptor_if_owner(&self.descriptor_path, &self.app_instance_id);
    }
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct HttpRejection {
    status: u16,
    code: &'static str,
}

#[derive(Debug)]
struct IngressAcceptedEvent {
    event: WorkflowEventWire,
    suppress_emit: bool,
    flush_after: Option<Duration>,
}

#[derive(Debug)]
enum IngressDecision {
    Accept(IngressAcceptedEvent),
    Duplicate,
}

#[derive(Debug)]
struct HandlerResult {
    #[allow(dead_code)]
    snapshot: PartnerStateSnapshot,
}

type EventHandler =
    Arc<dyn Fn(IngressAcceptedEvent) -> Result<HandlerResult, String> + Send + Sync + 'static>;

#[derive(Debug)]
struct IngressGate {
    token: String,
    config: IngressConfig,
    budget: Mutex<IngressBudget>,
}

#[derive(Debug, Default)]
struct IngressBudget {
    seen_events: HashMap<String, Instant>,
    seen_order: VecDeque<String>,
    runs: HashMap<String, RunBudget>,
}

#[derive(Debug)]
struct RunBudget {
    tokens: f64,
    last_refill: Instant,
    last_passthrough: Option<Instant>,
}

#[derive(Clone, Debug, Default)]
struct IngressFlushScheduler {
    generations: Arc<Mutex<HashMap<String, u64>>>,
}

#[derive(Debug, PartialEq, Eq)]
enum BudgetDecision {
    PassThrough,
    Suppress,
    Duplicate,
}

impl IngressGate {
    fn new(token: String) -> Self {
        Self::with_config(token, IngressConfig::default())
    }

    fn with_config(token: String, config: IngressConfig) -> Self {
        Self {
            token,
            config,
            budget: Mutex::new(IngressBudget::default()),
        }
    }

    fn validate_request(&self, request: HttpRequest) -> Result<IngressDecision, HttpRejection> {
        if request.method.eq_ignore_ascii_case("OPTIONS") || has_header(&request, "origin") {
            return Err(HttpRejection::new(403, "origin_rejected"));
        }

        if has_header(&request, "access-control-request-method") {
            return Err(HttpRejection::new(403, "cors_preflight_rejected"));
        }

        if request.method != "POST" {
            return Err(HttpRejection::new(405, "method_not_allowed"));
        }

        if request.path != "/events" {
            return Err(HttpRejection::new(404, "not_found"));
        }

        let authorization = header_value(&request, "authorization")
            .ok_or_else(|| HttpRejection::new(401, "missing_bearer_token"))?;
        if authorization.trim() != format!("Bearer {}", self.token) {
            return Err(HttpRejection::new(401, "invalid_bearer_token"));
        }

        let content_type = header_value(&request, "content-type")
            .ok_or_else(|| HttpRejection::new(415, "missing_content_type"))?;
        if !content_type
            .split(';')
            .next()
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
        {
            return Err(HttpRejection::new(415, "unsupported_content_type"));
        }

        if request.body.len() > self.config.payload_limit {
            return Err(HttpRejection::new(413, "payload_too_large"));
        }

        let event = parse_event_payload(&request.body)?;
        let decision = self
            .budget
            .lock()
            .expect("ingress budget mutex poisoned")
            .record_event(&event, Instant::now(), &self.config);

        match decision {
            BudgetDecision::Duplicate => Ok(IngressDecision::Duplicate),
            BudgetDecision::PassThrough => Ok(IngressDecision::Accept(IngressAcceptedEvent {
                event,
                suppress_emit: false,
                flush_after: None,
            })),
            BudgetDecision::Suppress => Ok(IngressDecision::Accept(IngressAcceptedEvent {
                event,
                suppress_emit: true,
                flush_after: Some(trailing_flush_after(self.config.debounce)),
            })),
        }
    }
}

impl IngressFlushScheduler {
    fn schedule(
        &self,
        app: AppHandle,
        store: PartnerStateStore,
        run_id: String,
        flush_after: Duration,
    ) {
        let generation = {
            let mut generations = self
                .generations
                .lock()
                .expect("ingress flush mutex poisoned");
            let generation = generations.entry(run_id.clone()).or_insert(0);
            *generation += 1;
            *generation
        };
        let scheduler = self.clone();

        thread::spawn(move || {
            thread::sleep(flush_after);
            if !scheduler.is_latest(&run_id, generation) {
                return;
            }

            let snapshot = store.current_snapshot();
            if snapshot.paused || !snapshot_matches_flush_run(&snapshot, &run_id) {
                return;
            }

            let _ = app.emit(PARTNER_STATE_CHANGED_EVENT, snapshot);
        });
    }

    fn is_latest(&self, run_id: &str, generation: u64) -> bool {
        self.generations
            .lock()
            .expect("ingress flush mutex poisoned")
            .get(run_id)
            .is_some_and(|current| *current == generation)
    }
}

impl IngressBudget {
    fn record_event(
        &mut self,
        event: &WorkflowEventWire,
        now: Instant,
        config: &IngressConfig,
    ) -> BudgetDecision {
        self.prune_seen_events(now, config);
        if self.seen_events.contains_key(&event.event_id) {
            return BudgetDecision::Duplicate;
        }

        self.seen_events.insert(event.event_id.clone(), now);
        self.seen_order.push_back(event.event_id.clone());
        self.prune_seen_events(now, config);

        let run_budget = self
            .runs
            .entry(event.run_id.clone())
            .or_insert_with(|| RunBudget {
                tokens: config.rate_burst,
                last_refill: now,
                last_passthrough: None,
            });

        refill_run_budget(run_budget, now, config);
        if run_budget.tokens < 1.0 {
            return BudgetDecision::Suppress;
        }
        run_budget.tokens -= 1.0;

        if let Some(last_passthrough) = run_budget.last_passthrough {
            if now.saturating_duration_since(last_passthrough) < config.debounce {
                return BudgetDecision::Suppress;
            }
        }

        run_budget.last_passthrough = Some(now);
        BudgetDecision::PassThrough
    }

    fn prune_seen_events(&mut self, now: Instant, config: &IngressConfig) {
        while let Some(event_id) = self.seen_order.front() {
            let should_remove =
                self.seen_events.get(event_id).is_none_or(|seen_at| {
                    now.saturating_duration_since(*seen_at) > config.dedupe_ttl
                }) || self.seen_events.len() > config.dedupe_max_events;

            if !should_remove {
                break;
            }

            if let Some(event_id) = self.seen_order.pop_front() {
                self.seen_events.remove(&event_id);
            }
        }
    }
}

impl HttpRejection {
    fn new(status: u16, code: &'static str) -> Self {
        Self { status, code }
    }
}

impl RuntimeDescriptor {
    fn new(port: u16, token: String) -> Result<Self, String> {
        Ok(Self {
            schema_version: RUNTIME_DESCRIPTOR_SCHEMA_VERSION.to_string(),
            app_instance_id: generate_app_instance_id()?,
            pid: std::process::id(),
            port,
            token,
            created_at: Utc::now().to_rfc3339(),
        })
    }
}

pub fn start_local_ingress(
    app: AppHandle,
    store: PartnerStateStore,
) -> Result<LocalIngress, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("failed to bind local ingress: {error}"))?;
    let addr = listener
        .local_addr()
        .map_err(|error| format!("failed to read local ingress addr: {error}"))?;
    ensure_loopback_addr(addr)?;

    let token = generate_token()?;
    let port = u16::try_from(addr.port()).map_err(|_| "local ingress port is invalid")?;
    let descriptor = RuntimeDescriptor::new(port, token.clone())?;
    let descriptor_path = default_runtime_descriptor_path();
    cleanup_stale_descriptor(&descriptor_path);
    write_runtime_descriptor(&descriptor_path, &descriptor)?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let gate = Arc::new(IngressGate::new(token));
    let flush_scheduler = IngressFlushScheduler::default();
    let handler = {
        let app = app.clone();
        let store = store.clone();
        let flush_scheduler = flush_scheduler.clone();
        Arc::new(move |accepted: IngressAcceptedEvent| {
            let run_id = accepted.event.run_id.clone();
            let flush_after = accepted.flush_after;
            let transition = store.apply_workflow_event(accepted.event)?;
            let can_emit = transition.should_emit;
            crate::publish_state_transition(
                &app,
                &store,
                &transition,
                can_emit && !accepted.suppress_emit,
                can_emit,
            );
            if accepted.suppress_emit && can_emit {
                if let Some(flush_after) = flush_after {
                    flush_scheduler.schedule(app.clone(), store.clone(), run_id, flush_after);
                }
            }
            Ok(HandlerResult {
                snapshot: transition.snapshot,
            })
        }) as EventHandler
    };
    let worker = spawn_server_thread(listener, shutdown.clone(), gate, handler);

    Ok(LocalIngress {
        descriptor_path,
        app_instance_id: descriptor.app_instance_id,
        shutdown,
        addr,
        worker: Mutex::new(Some(worker)),
    })
}

fn spawn_server_thread(
    listener: TcpListener,
    shutdown: Arc<AtomicBool>,
    gate: Arc<IngressGate>,
    handler: EventHandler,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let _ = listener.set_nonblocking(true);
        while !shutdown.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    if !peer_is_loopback(&stream) {
                        continue;
                    }
                    let gate = gate.clone();
                    let handler = handler.clone();
                    thread::spawn(move || {
                        handle_connection(stream, gate, handler);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(10));
                }
            }
        }
    })
}

fn handle_connection(mut stream: TcpStream, gate: Arc<IngressGate>, handler: EventHandler) {
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(READ_TIMEOUT));

    let response = match read_http_request(&mut stream) {
        Ok(request) => match gate.validate_request(request) {
            Ok(IngressDecision::Duplicate) => HttpResponse::json(202, r#"{"ok":true}"#),
            Ok(IngressDecision::Accept(event)) => match handler(event) {
                Ok(_) => HttpResponse::json(202, r#"{"ok":true}"#),
                Err(_) => HttpResponse::json(400, r#"{"ok":false,"error":"invalid_event"}"#),
            },
            Err(rejection) => rejection.into_response(),
        },
        Err(rejection) => rejection.into_response(),
    };

    let _ = stream.write_all(&response.into_bytes());
    let _ = stream.flush();
}

fn read_http_request(stream: &mut impl Read) -> Result<HttpRequest, HttpRejection> {
    let mut bytes = Vec::new();
    let read_deadline = Instant::now() + READ_TIMEOUT;
    let header_end = loop {
        if let Some(header_end) = find_header_end(&bytes) {
            if header_end > MAX_HEADER_BYTES {
                return Err(HttpRejection::new(431, "headers_too_large"));
            }
            break header_end;
        }
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(HttpRejection::new(431, "headers_too_large"));
        }

        let mut chunk = [0_u8; 1024];
        let read = read_http_chunk(stream, &mut chunk, read_deadline)?;
        if read == 0 {
            return Err(HttpRejection::new(400, "incomplete_request"));
        }
        bytes.extend_from_slice(&chunk[..read]);
    };

    let header_bytes = &bytes[..header_end];
    let header_text = std::str::from_utf8(header_bytes)
        .map_err(|_| HttpRejection::new(400, "invalid_headers"))?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| HttpRejection::new(400, "missing_request_line"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| HttpRejection::new(400, "missing_method"))?;
    let path = request_parts
        .next()
        .ok_or_else(|| HttpRejection::new(400, "missing_path"))?;
    let version = request_parts
        .next()
        .ok_or_else(|| HttpRejection::new(400, "missing_http_version"))?;
    if !version.starts_with("HTTP/1.") {
        return Err(HttpRejection::new(400, "unsupported_http_version"));
    }

    let method = method.to_string();
    let path = path.to_string();
    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| HttpRejection::new(400, "invalid_header"))?;
        headers.push((name.trim().to_string(), value.trim().to_string()));
    }

    if method != "POST" {
        return Ok(HttpRequest {
            method,
            path,
            headers,
            body: Vec::new(),
        });
    }

    if header_values(&headers, "transfer-encoding")
        .iter()
        .flat_map(|value| value.split(','))
        .any(|value| value.trim().eq_ignore_ascii_case("chunked"))
    {
        return Err(HttpRejection::new(400, "chunked_not_supported"));
    }

    let content_lengths = header_values(&headers, "content-length");
    if content_lengths.len() > 1 {
        return Err(HttpRejection::new(400, "duplicate_content_length"));
    }

    let content_length = content_lengths
        .first()
        .ok_or_else(|| HttpRejection::new(411, "missing_content_length"))?
        .parse::<usize>()
        .map_err(|_| HttpRejection::new(400, "invalid_content_length"))?;
    if content_length > MAX_PAYLOAD_BYTES {
        return Err(HttpRejection::new(413, "payload_too_large"));
    }

    let body_start = header_end + 4;
    while bytes.len() < body_start + content_length {
        let mut chunk = [0_u8; 1024];
        let read = read_http_chunk(stream, &mut chunk, read_deadline)?;
        if read == 0 {
            return Err(HttpRejection::new(400, "incomplete_body"));
        }
        bytes.extend_from_slice(&chunk[..read]);
    }

    Ok(HttpRequest {
        method,
        path,
        headers,
        body: bytes[body_start..body_start + content_length].to_vec(),
    })
}

fn read_http_chunk(
    stream: &mut impl Read,
    chunk: &mut [u8],
    deadline: Instant,
) -> Result<usize, HttpRejection> {
    loop {
        match stream.read(chunk) {
            Ok(read) => return Ok(read),
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(HttpRejection::new(400, "request_read_timed_out"));
                }
                thread::sleep(Duration::from_millis(1));
                continue;
            }
            Err(error) => {
                return Err(HttpRejection::new(
                    400,
                    request_read_failed_code(error.kind()),
                ))
            }
        }
    }
}

fn request_read_failed_code(kind: ErrorKind) -> &'static str {
    match kind {
        ErrorKind::TimedOut => "request_read_timed_out",
        ErrorKind::WouldBlock => "request_read_would_block",
        ErrorKind::ConnectionReset => "request_read_connection_reset",
        ErrorKind::ConnectionAborted => "request_read_connection_aborted",
        _ => "request_read_failed",
    }
}

fn parse_event_payload(body: &[u8]) -> Result<WorkflowEventWire, HttpRejection> {
    let value: Value =
        serde_json::from_slice(body).map_err(|_| HttpRejection::new(400, "invalid_json"))?;
    inspect_event_value(&value)?;
    let event: WorkflowEventWire =
        serde_json::from_value(value).map_err(|_| HttpRejection::new(400, "invalid_event"))?;
    event
        .validate()
        .map_err(|_| HttpRejection::new(400, "invalid_event"))?;
    Ok(event)
}

fn inspect_event_value(value: &Value) -> Result<(), HttpRejection> {
    reject_forbidden_fields(value)?;
    let object = value
        .as_object()
        .ok_or_else(|| HttpRejection::new(400, "event_must_be_object"))?;

    for key in object.keys() {
        if !ALLOWED_EVENT_FIELDS.contains(&key.as_str()) {
            return Err(HttpRejection::new(400, "unknown_event_field"));
        }
    }
    if object
        .get("message")
        .is_some_and(|message| !message.is_string())
    {
        return Err(HttpRejection::new(400, "invalid_event"));
    }

    Ok(())
}

fn reject_forbidden_fields(value: &Value) -> Result<(), HttpRejection> {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if FORBIDDEN_FIELDS.contains(&key.as_str()) {
                    return Err(HttpRejection::new(400, "forbidden_event_field"));
                }
                reject_forbidden_fields(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                reject_forbidden_fields(value)?;
            }
        }
        _ => {}
    }

    Ok(())
}

fn refill_run_budget(run_budget: &mut RunBudget, now: Instant, config: &IngressConfig) {
    let elapsed = now
        .saturating_duration_since(run_budget.last_refill)
        .as_secs_f64();
    run_budget.tokens =
        (run_budget.tokens + elapsed * config.rate_tokens_per_second).min(config.rate_burst);
    run_budget.last_refill = now;
}

fn trailing_flush_after(debounce: Duration) -> Duration {
    if debounce.is_zero() {
        Duration::from_millis(1)
    } else {
        debounce
    }
}

fn snapshot_matches_flush_run(snapshot: &PartnerStateSnapshot, run_id: &str) -> bool {
    snapshot.active_run_id.as_deref() == Some(run_id)
        || snapshot.run_id.as_deref() == Some(run_id)
        || (snapshot.active_run_id.is_none() && snapshot.run_id.is_none())
}

fn has_header(request: &HttpRequest, name: &str) -> bool {
    header_value(request, name).is_some()
}

fn header_value<'a>(request: &'a HttpRequest, name: &str) -> Option<&'a str> {
    request
        .headers
        .iter()
        .rev()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn header_values<'a>(headers: &'a [(String, String)], name: &str) -> Vec<&'a str> {
    headers
        .iter()
        .filter(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
        .collect()
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn peer_is_loopback(stream: &TcpStream) -> bool {
    stream.peer_addr().is_ok_and(|addr| addr.ip().is_loopback())
}

fn ensure_loopback_addr(addr: SocketAddr) -> Result<(), String> {
    if addr.ip() == IpAddr::V4(Ipv4Addr::LOCALHOST) {
        Ok(())
    } else {
        Err(format!("local ingress must bind 127.0.0.1, got {addr}"))
    }
}

fn default_runtime_descriptor_path() -> PathBuf {
    std::env::temp_dir()
        .join(DESCRIPTOR_DIR_NAME)
        .join(DESCRIPTOR_FILE_NAME)
}

fn cleanup_stale_descriptor(path: &Path) {
    let Ok(raw) = fs::read_to_string(path) else {
        return;
    };
    let Ok(descriptor) = serde_json::from_str::<RuntimeDescriptor>(&raw) else {
        let _ = fs::remove_file(path);
        return;
    };

    if runtime_descriptor_is_stale(&descriptor) {
        let _ = fs::remove_file(path);
    }
}

fn runtime_descriptor_is_stale(descriptor: &RuntimeDescriptor) -> bool {
    if descriptor.schema_version != RUNTIME_DESCRIPTOR_SCHEMA_VERSION
        || descriptor.pid == 0
        || descriptor.port == 0
        || chrono::DateTime::parse_from_rfc3339(&descriptor.created_at).is_err()
    {
        return true;
    }

    if !process_is_alive(descriptor.pid) {
        return true;
    }

    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), descriptor.port);
    TcpStream::connect_timeout(&addr, STALE_PORT_CHECK_TIMEOUT).is_err()
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };

    unsafe { libc::kill(pid, 0) == 0 || current_errno() == libc::EPERM }
}

#[cfg(all(unix, target_os = "macos"))]
fn current_errno() -> i32 {
    unsafe { *libc::__error() }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn current_errno() -> i32 {
    unsafe { *libc::__errno_location() }
}

#[cfg(not(unix))]
fn process_is_alive(_pid: u32) -> bool {
    true
}

fn write_runtime_descriptor(path: &Path, descriptor: &RuntimeDescriptor) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "runtime descriptor path must have a parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create runtime descriptor dir: {error}"))?;
    set_owner_only_dir_permissions(parent)?;

    let tmp_path = parent.join(format!(
        ".{}.{}.tmp",
        DESCRIPTOR_FILE_NAME, descriptor.app_instance_id
    ));
    let _ = fs::remove_file(&tmp_path);

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    open_owner_only(&mut options);
    let mut file = options
        .open(&tmp_path)
        .map_err(|error| format!("failed to create runtime descriptor temp file: {error}"))?;
    let bytes = serde_json::to_vec_pretty(descriptor)
        .map_err(|error| format!("failed to serialize runtime descriptor: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("failed to write runtime descriptor: {error}"))?;
    file.write_all(b"\n")
        .map_err(|error| format!("failed to finish runtime descriptor: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("failed to sync runtime descriptor: {error}"))?;
    drop(file);
    set_owner_only_file_permissions(&tmp_path)?;

    fs::rename(&tmp_path, path)
        .map_err(|error| format!("failed to publish runtime descriptor: {error}"))?;
    set_owner_only_file_permissions(path)?;

    Ok(())
}

fn remove_runtime_descriptor_if_owner(path: &Path, app_instance_id: &str) -> Result<(), String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read runtime descriptor before cleanup: {error}"))?;
    let descriptor = serde_json::from_str::<RuntimeDescriptor>(&raw)
        .map_err(|error| format!("failed to parse runtime descriptor before cleanup: {error}"))?;
    if descriptor.app_instance_id == app_instance_id {
        fs::remove_file(path)
            .map_err(|error| format!("failed to remove runtime descriptor: {error}"))?;
    }

    Ok(())
}

fn generate_app_instance_id() -> Result<String, String> {
    let suffix = generate_hex_token(8)?;
    Ok(format!(
        "app_{}_{}_{}",
        Utc::now().format("%Y%m%dT%H%M%SZ"),
        std::process::id(),
        suffix
    ))
}

fn generate_token() -> Result<String, String> {
    generate_hex_token(32)
}

fn generate_hex_token(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("failed to generate runtime token: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(unix)]
fn open_owner_only(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;

    options.mode(0o600);
}

#[cfg(not(unix))]
fn open_owner_only(_options: &mut OpenOptions) {}

#[cfg(unix)]
fn set_owner_only_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("failed to set runtime descriptor file permissions: {error}"))
}

#[cfg(not(unix))]
fn set_owner_only_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_owner_only_dir_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("failed to set runtime descriptor dir permissions: {error}"))
}

#[cfg(not(unix))]
fn set_owner_only_dir_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

struct HttpResponse {
    status: u16,
    body: String,
}

impl HttpResponse {
    fn json(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            body: body.into(),
        }
    }

    fn into_bytes(self) -> Vec<u8> {
        let body = self.body.as_bytes();
        format!(
            "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            self.status,
            status_text(self.status),
            body.len(),
            self.body
        )
        .into_bytes()
    }
}

impl HttpRejection {
    fn into_response(self) -> HttpResponse {
        let body = match self.code {
            "payload_too_large" => r#"{"ok":false,"error":"payload_too_large"}"#.to_string(),
            "missing_bearer_token" | "invalid_bearer_token" => {
                r#"{"ok":false,"error":"unauthorized"}"#.to_string()
            }
            "origin_rejected" | "cors_preflight_rejected" => {
                r#"{"ok":false,"error":"origin_rejected"}"#.to_string()
            }
            code => format!(r#"{{"ok":false,"error":"{code}"}}"#),
        };

        HttpResponse::json(self.status, body)
    }
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        411 => "Length Required",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        431 => "Request Header Fields Too Large",
        _ => "Error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{WorkflowSource, WorkflowState, WORKFLOW_EVENT_SCHEMA_VERSION};
    use std::io::{Error, Read};
    fn token() -> String {
        "test_runtime_token_1234567890".to_string()
    }

    struct InterruptedOnce {
        bytes: std::io::Cursor<Vec<u8>>,
        interrupted: bool,
    }

    impl InterruptedOnce {
        fn new(bytes: Vec<u8>) -> Self {
            Self {
                bytes: std::io::Cursor::new(bytes),
                interrupted: false,
            }
        }
    }

    impl Read for InterruptedOnce {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if !self.interrupted {
                self.interrupted = true;
                return Err(Error::from(ErrorKind::Interrupted));
            }

            self.bytes.read(buf)
        }
    }

    struct WouldBlockOnce {
        bytes: std::io::Cursor<Vec<u8>>,
        blocked: bool,
    }

    impl WouldBlockOnce {
        fn new(bytes: Vec<u8>) -> Self {
            Self {
                bytes: std::io::Cursor::new(bytes),
                blocked: false,
            }
        }
    }

    impl Read for WouldBlockOnce {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if !self.blocked {
                self.blocked = true;
                return Err(Error::from(ErrorKind::WouldBlock));
            }

            self.bytes.read(buf)
        }
    }

    fn event(event_id: &str, run_id: &str, workflow_state: WorkflowState) -> WorkflowEventWire {
        WorkflowEventWire {
            schema_version: WORKFLOW_EVENT_SCHEMA_VERSION.to_string(),
            event_id: event_id.to_string(),
            source: WorkflowSource::DemoScript,
            run_id: run_id.to_string(),
            workflow_state,
            timestamp: "2026-06-03T00:00:00Z".to_string(),
            message: Some("working".to_string()),
            code_context_allowed: false,
        }
    }

    fn json_event(event_id: &str, run_id: &str, workflow_state: WorkflowState) -> Vec<u8> {
        serde_json::to_vec(&event(event_id, run_id, workflow_state)).expect("event should encode")
    }

    fn request(body: Vec<u8>, authorization: Option<String>) -> HttpRequest {
        let mut headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("content-length".to_string(), body.len().to_string()),
        ];
        if let Some(authorization) = authorization {
            headers.push(("authorization".to_string(), authorization));
        }

        HttpRequest {
            method: "POST".to_string(),
            path: "/events".to_string(),
            headers,
            body,
        }
    }

    fn unique_temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ai-partner-test-{name}-{}-{}",
            std::process::id(),
            generate_hex_token(4).expect("token should generate")
        ))
    }

    #[test]
    fn descriptor_write_is_atomic_owner_only_and_cleanup_respects_owner() {
        let dir = unique_temp_path("descriptor");
        let path = dir.join(DESCRIPTOR_FILE_NAME);
        let descriptor = RuntimeDescriptor {
            schema_version: RUNTIME_DESCRIPTOR_SCHEMA_VERSION.to_string(),
            app_instance_id: "app_test_descriptor".to_string(),
            pid: std::process::id(),
            port: 43172,
            token: token(),
            created_at: "2026-06-03T00:00:00Z".to_string(),
        };

        write_runtime_descriptor(&path, &descriptor).expect("descriptor should write");
        let raw = fs::read_to_string(&path).expect("descriptor should be readable");
        assert!(raw.contains("\"schemaVersion\""));
        assert!(serde_json::from_str::<RuntimeDescriptor>(&raw).is_ok());
        assert!(!dir
            .join(format!(
                ".{}.{}.tmp",
                DESCRIPTOR_FILE_NAME, descriptor.app_instance_id
            ))
            .exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            assert_eq!(
                fs::metadata(&path)
                    .expect("descriptor metadata should load")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(&dir)
                    .expect("descriptor dir metadata should load")
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }

        remove_runtime_descriptor_if_owner(&path, "app_other")
            .expect("other owner should not delete");
        assert!(path.exists());
        remove_runtime_descriptor_if_owner(&path, "app_test_descriptor")
            .expect("owner should delete");
        assert!(!path.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn stale_descriptor_cleanup_removes_unreachable_port() {
        let dir = unique_temp_path("stale");
        let path = dir.join(DESCRIPTOR_FILE_NAME);
        let descriptor = RuntimeDescriptor {
            schema_version: RUNTIME_DESCRIPTOR_SCHEMA_VERSION.to_string(),
            app_instance_id: "app_test_stale".to_string(),
            pid: std::process::id(),
            port: 1,
            token: token(),
            created_at: "2026-06-03T00:00:00Z".to_string(),
        };
        write_runtime_descriptor(&path, &descriptor).expect("descriptor should write");

        cleanup_stale_descriptor(&path);

        assert!(!path.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn gate_rejects_missing_or_bad_auth_and_origin_requests() {
        let gate = IngressGate::new(token());
        let body = json_event("evt_auth", "run_auth", WorkflowState::Running);

        let missing_auth = gate
            .validate_request(request(body.clone(), None))
            .expect_err("missing auth should reject");
        assert_eq!(missing_auth.status, 401);

        let bad_auth = gate
            .validate_request(request(body.clone(), Some("Bearer wrong".to_string())))
            .expect_err("bad auth should reject");
        assert_eq!(bad_auth.status, 401);

        let mut origin = request(body, Some(format!("Bearer {}", token())));
        origin
            .headers
            .push(("origin".to_string(), "https://example.test".to_string()));
        let rejection = gate
            .validate_request(origin)
            .expect_err("origin should reject");
        assert_eq!(rejection.status, 403);
    }

    #[test]
    fn gate_rejects_payload_too_large_unknown_and_forbidden_fields() {
        let gate = IngressGate::new(token());
        let oversized = vec![b'a'; MAX_PAYLOAD_BYTES + 1];
        let rejection = gate
            .validate_request(request(oversized, Some(format!("Bearer {}", token()))))
            .expect_err("oversized payload should reject");
        assert_eq!(rejection.status, 413);

        let mut unknown =
            serde_json::to_value(event("evt_unknown", "run_unknown", WorkflowState::Reading))
                .expect("event should encode");
        unknown["extra"] = Value::String("nope".to_string());
        let rejection = gate
            .validate_request(request(
                serde_json::to_vec(&unknown).expect("json should encode"),
                Some(format!("Bearer {}", token())),
            ))
            .expect_err("unknown field should reject");
        assert_eq!(rejection.code, "unknown_event_field");

        let mut forbidden = serde_json::to_value(event(
            "evt_forbidden",
            "run_forbidden",
            WorkflowState::Reading,
        ))
        .expect("event should encode");
        forbidden["diff"] = Value::String("secret".to_string());
        let rejection = gate
            .validate_request(request(
                serde_json::to_vec(&forbidden).expect("json should encode"),
                Some(format!("Bearer {}", token())),
            ))
            .expect_err("forbidden field should reject");
        assert_eq!(rejection.code, "forbidden_event_field");

        let mut null_message = serde_json::to_value(event(
            "evt_null_message",
            "run_null_message",
            WorkflowState::Reading,
        ))
        .expect("event should encode");
        null_message["message"] = Value::Null;
        let rejection = gate
            .validate_request(request(
                serde_json::to_vec(&null_message).expect("json should encode"),
                Some(format!("Bearer {}", token())),
            ))
            .expect_err("message:null should reject");
        assert_eq!(rejection.code, "invalid_event");
    }

    #[test]
    fn parser_rejects_chunked_duplicate_content_length_and_over_cap_headers() {
        let body = json_event("evt_parser", "run_parser", WorkflowState::Running);
        let chunked = format!(
            "POST /events HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: gzip, chunked\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            body.len()
        );
        let duplicate = format!(
            "POST /events HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {}\r\nContent-Length: {}\r\nContent-Type: application/json\r\n\r\n",
            body.len(),
            body.len()
        );
        let oversized_header = format!(
            "POST /events HTTP/1.1\r\nX-Fill: {}\r\nContent-Length: 0\r\n\r\n",
            "a".repeat(MAX_HEADER_BYTES + 1)
        );

        let mut chunked_stream = chunked.into_bytes();
        chunked_stream.extend_from_slice(&body);
        let mut duplicate_stream = duplicate.into_bytes();
        duplicate_stream.extend_from_slice(&body);

        assert_eq!(
            read_http_request(&mut std::io::Cursor::new(chunked_stream))
                .expect_err("chunked request should reject")
                .code,
            "chunked_not_supported"
        );
        assert_eq!(
            read_http_request(&mut std::io::Cursor::new(duplicate_stream))
                .expect_err("duplicate content-length should reject")
                .code,
            "duplicate_content_length"
        );
        assert_eq!(
            read_http_request(&mut std::io::Cursor::new(oversized_header.into_bytes()))
                .expect_err("oversized header should reject")
                .code,
            "headers_too_large"
        );
    }

    #[test]
    fn parser_allows_bodyless_method_probe_to_reach_method_rejection() {
        let raw = b"GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let request = read_http_request(&mut std::io::Cursor::new(raw))
            .expect("bodyless method probe should parse");

        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/events");
        assert!(request.body.is_empty());

        let gate = IngressGate::new(token());
        let rejection = gate
            .validate_request(request)
            .expect_err("GET probe should be rejected after parsing");
        assert_eq!(rejection.status, 405);
        assert_eq!(rejection.code, "method_not_allowed");
    }

    #[test]
    fn parser_retries_interrupted_reads() {
        let raw = b"GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let mut reader = InterruptedOnce::new(raw.to_vec());

        let request = read_http_request(&mut reader).expect("interrupted read should retry");

        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/events");
    }

    #[test]
    fn parser_retries_would_block_reads_until_deadline() {
        let raw = b"GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let mut reader = WouldBlockOnce::new(raw.to_vec());

        let request = read_http_request(&mut reader).expect("would-block read should retry");

        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/events");
    }

    #[test]
    fn rejection_response_includes_specific_local_error_code() {
        let response = HttpRejection::new(400, "invalid_content_length").into_response();

        let text = String::from_utf8(response.into_bytes()).expect("response should be utf8");
        assert!(text.starts_with("HTTP/1.1 400 Bad Request"));
        assert!(text.ends_with(r#"{"ok":false,"error":"invalid_content_length"}"#));
    }

    #[test]
    fn gate_dedupes_event_ids_and_suppresses_debounce() {
        let gate = IngressGate::with_config(
            token(),
            IngressConfig {
                debounce: Duration::from_secs(60),
                ..IngressConfig::default()
            },
        );
        let authorization = Some(format!("Bearer {}", token()));

        let first = gate
            .validate_request(request(
                json_event("evt_dedupe", "run_dedupe", WorkflowState::Running),
                authorization.clone(),
            ))
            .expect("first event should pass");
        assert!(matches!(
            first,
            IngressDecision::Accept(IngressAcceptedEvent {
                suppress_emit: false,
                ..
            })
        ));

        let duplicate = gate
            .validate_request(request(
                json_event("evt_dedupe", "run_dedupe", WorkflowState::Editing),
                authorization.clone(),
            ))
            .expect("duplicate should be accepted as duplicate");
        assert!(matches!(duplicate, IngressDecision::Duplicate));

        let debounced = gate
            .validate_request(request(
                json_event("evt_debounce", "run_dedupe", WorkflowState::Editing),
                authorization,
            ))
            .expect("second unique event should apply but suppress emit");
        assert!(matches!(
            debounced,
            IngressDecision::Accept(IngressAcceptedEvent {
                suppress_emit: true,
                ..
            })
        ));
    }

    #[test]
    fn suppressed_events_carry_trailing_flush_delay() {
        let gate = IngressGate::with_config(
            token(),
            IngressConfig {
                debounce: Duration::from_millis(300),
                ..IngressConfig::default()
            },
        );
        let authorization = Some(format!("Bearer {}", token()));

        let _ = gate
            .validate_request(request(
                json_event("evt_flush_running", "run_flush", WorkflowState::Running),
                authorization.clone(),
            ))
            .expect("first event should pass");
        let suppressed_done = gate
            .validate_request(request(
                json_event("evt_flush_done", "run_flush", WorkflowState::Done),
                authorization,
            ))
            .expect("debounced done should still apply with flush");

        assert!(matches!(
            suppressed_done,
            IngressDecision::Accept(IngressAcceptedEvent {
                suppress_emit: true,
                flush_after: Some(delay),
                ..
            }) if delay == Duration::from_millis(300)
        ));
    }

    #[test]
    fn flush_scheduler_tracks_latest_generation_per_run() {
        let scheduler = IngressFlushScheduler::default();
        {
            let mut generations = scheduler
                .generations
                .lock()
                .expect("flush mutex should lock");
            generations.insert("run_flush".to_string(), 2);
        }

        assert!(!scheduler.is_latest("run_flush", 1));
        assert!(scheduler.is_latest("run_flush", 2));
        assert!(!scheduler.is_latest("run_missing", 1));
    }

    #[test]
    fn dedupe_cache_expires_by_ttl_and_evicts_by_lru_cap() {
        let mut budget = IngressBudget::default();
        let config = IngressConfig {
            dedupe_ttl: Duration::from_millis(10),
            dedupe_max_events: 2,
            debounce: Duration::ZERO,
            ..IngressConfig::default()
        };
        let start = Instant::now();
        let first = event("evt_ttl", "run_ttl", WorkflowState::Running);

        assert_eq!(
            budget.record_event(&first, start, &config),
            BudgetDecision::PassThrough
        );
        assert_eq!(
            budget.record_event(&first, start + Duration::from_millis(5), &config),
            BudgetDecision::Duplicate
        );
        assert_eq!(
            budget.record_event(&first, start + Duration::from_millis(11), &config),
            BudgetDecision::PassThrough
        );

        let second = event("evt_lru_2", "run_lru", WorkflowState::Running);
        let third = event("evt_lru_3", "run_lru", WorkflowState::Running);
        let fourth = event("evt_lru_4", "run_lru", WorkflowState::Running);
        assert_eq!(
            budget.record_event(&second, start + Duration::from_millis(12), &config),
            BudgetDecision::PassThrough
        );
        assert_eq!(
            budget.record_event(&third, start + Duration::from_millis(13), &config),
            BudgetDecision::PassThrough
        );
        assert_eq!(
            budget.record_event(&fourth, start + Duration::from_millis(14), &config),
            BudgetDecision::PassThrough
        );
        assert!(budget.seen_events.len() <= 2);
        assert!(!budget.seen_events.contains_key("evt_lru_2"));
    }

    #[test]
    fn gate_rate_limit_suppresses_after_burst_but_keeps_accepting() {
        let gate = IngressGate::with_config(
            token(),
            IngressConfig {
                debounce: Duration::ZERO,
                ..IngressConfig::default()
            },
        );
        let authorization = Some(format!("Bearer {}", token()));

        for index in 0..30 {
            let decision = gate
                .validate_request(request(
                    json_event(
                        &format!("evt_rate_{index}"),
                        "run_rate",
                        WorkflowState::Running,
                    ),
                    authorization.clone(),
                ))
                .expect("burst event should pass");
            assert!(matches!(
                decision,
                IngressDecision::Accept(IngressAcceptedEvent {
                    suppress_emit: false,
                    ..
                })
            ));
        }

        let limited = gate
            .validate_request(request(
                json_event("evt_rate_over", "run_rate", WorkflowState::Waiting),
                authorization,
            ))
            .expect("over-budget event should still apply");
        assert!(matches!(
            limited,
            IngressDecision::Accept(IngressAcceptedEvent {
                suppress_emit: true,
                ..
            })
        ));
    }

    #[test]
    fn accepted_http_event_updates_state_store() {
        let gate = IngressGate::new(token());
        let store = PartnerStateStore::new(Duration::from_millis(1));
        let decision = gate
            .validate_request(request(
                json_event("evt_http", "run_http", WorkflowState::Waiting),
                Some(format!("Bearer {}", token())),
            ))
            .expect("valid HTTP request should pass ingress gate");

        let IngressDecision::Accept(accepted) = decision else {
            panic!("valid HTTP request should produce an accepted event");
        };
        let transition = store
            .apply_workflow_event(accepted.event)
            .expect("accepted event should apply");

        assert!(!accepted.suppress_emit);
        assert!(transition.should_emit);
        let snapshot = store.current_snapshot();
        assert_eq!(snapshot.workflow_state, WorkflowState::Waiting);
        assert_eq!(snapshot.active_run_id.as_deref(), Some("run_http"));
    }

    #[test]
    fn accepted_event_updates_snapshot_while_paused_without_emit() {
        let store = PartnerStateStore::new(Duration::from_millis(1));
        store.pause();

        let accepted = IngressAcceptedEvent {
            event: event("evt_paused", "run_paused", WorkflowState::Waiting),
            suppress_emit: false,
            flush_after: None,
        };
        let transition = store
            .apply_workflow_event(accepted.event)
            .expect("paused ingress event should still apply");
        let should_emit = transition.should_emit && !accepted.suppress_emit;

        assert!(!should_emit);
        assert_eq!(transition.snapshot.workflow_state, WorkflowState::Waiting);
        assert!(store.current_snapshot().paused);
        assert_eq!(
            store.current_snapshot().active_run_id.as_deref(),
            Some("run_paused")
        );
    }

    #[test]
    fn loopback_guard_rejects_non_localhost_bind_addresses() {
        ensure_loopback_addr(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 43172))
            .expect("127.0.0.1 should be allowed");
        let rejection = ensure_loopback_addr(SocketAddr::new(
            IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),
            43172,
        ))
        .expect_err("0.0.0.0 must be rejected");
        assert!(rejection.contains("127.0.0.1"));
    }
}
