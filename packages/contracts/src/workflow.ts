import { WORKFLOW_EVENT_SCHEMA_VERSION } from "./versions";

export const workflowStates = [
  "idle",
  "running",
  "reading",
  "editing",
  "waiting",
  "error",
  "done"
] as const;

export const workflowSources = [
  "cli",
  "codex-wrapper",
  "demo-script",
  "claude-hook"
] as const;
export const workflowEventSources = workflowSources;

export const authorizationKinds = ["command", "tool"] as const;
export const authorizationStatuses = ["pending", "allowed", "denied"] as const;

export type WorkflowState = (typeof workflowStates)[number];
export type WorkflowSource = (typeof workflowEventSources)[number];
export type AuthorizationKind = (typeof authorizationKinds)[number];
export type AuthorizationStatus = (typeof authorizationStatuses)[number];

export interface WorkflowAuthorization {
  kind: AuthorizationKind;
  id: string;
  title?: string;
  description: string;
  status: AuthorizationStatus;
  decidedAt?: string;
}

export interface WorkflowEventWire {
  schemaVersion: typeof WORKFLOW_EVENT_SCHEMA_VERSION;
  event_id: string;
  source: WorkflowSource;
  run_id: string;
  workflow_state: WorkflowState;
  timestamp: string;
  message?: string;
  card_title?: string;
  context_path?: string;
  authorization?: WorkflowAuthorization;
  code_context_allowed: false;
}

export interface WorkflowEvent {
  schemaVersion: typeof WORKFLOW_EVENT_SCHEMA_VERSION;
  eventId: string;
  source: WorkflowSource;
  runId: string;
  workflowState: WorkflowState;
  timestamp: string;
  message?: string;
  cardTitle?: string;
  contextPath?: string;
  authorization?: WorkflowAuthorization;
  codeContextAllowed: false;
}
