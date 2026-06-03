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

export const workflowSources = ["cli", "codex-wrapper", "demo-script"] as const;

export type WorkflowState = (typeof workflowStates)[number];
export type WorkflowSource = (typeof workflowSources)[number];

export interface WorkflowEventWire {
  schemaVersion: typeof WORKFLOW_EVENT_SCHEMA_VERSION;
  event_id: string;
  source: WorkflowSource;
  run_id: string;
  workflow_state: WorkflowState;
  timestamp: string;
  message?: string;
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
  codeContextAllowed: false;
}
