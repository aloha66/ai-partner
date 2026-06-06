import { randomUUID } from "node:crypto";
import type { WorkflowEventWire } from "@ai-partner/contracts";
import { WORKFLOW_EVENT_SCHEMA_VERSION, normalizeMessage } from "@ai-partner/debug-cli";
import type { CodexWrapperWorkflowState } from "./classifier.js";

export interface CreateCodexWorkflowEventOptions {
  state: CodexWrapperWorkflowState;
  runId?: string;
  eventId?: string;
  timestamp?: Date;
}

export function createCodexWorkflowEvent(
  options: CreateCodexWorkflowEventOptions
): WorkflowEventWire {
  const runId = options.runId ?? createCodexRunId();
  const eventId = options.eventId ?? createCodexEventId(options.state);
  assertContractId(runId, "run_", "run_id");
  assertContractId(eventId, "evt_", "event_id");

  return {
    schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
    event_id: eventId,
    source: "codex-wrapper",
    run_id: runId,
    workflow_state: options.state,
    timestamp: (options.timestamp ?? new Date()).toISOString(),
    message: normalizeMessage(messageForWorkflowState(options.state)),
    code_context_allowed: false
  };
}

export function messageForWorkflowState(state: CodexWrapperWorkflowState): string {
  switch (state) {
    case "running":
      return "Codex is running";
    case "reading":
      return "Codex is reading";
    case "editing":
      return "Codex is editing";
    case "waiting":
      return "Codex is waiting";
    case "error":
      return "Codex exited with an error";
    case "done":
      return "Codex finished";
  }
}

export function createCodexRunId(now = new Date()): string {
  return `run_codex_${safeTimestamp(now)}_${randomUUID()}`;
}

export function createCodexEventId(state: CodexWrapperWorkflowState, now = new Date()): string {
  return `evt_codex_${state}_${safeTimestamp(now)}_${randomUUID()}`;
}

function assertContractId(value: string, prefix: string, field: string): void {
  if (value.length > 120 || !value.startsWith(prefix) || value.length === prefix.length) {
    throw new Error(`${field} must start with ${prefix} and be 120 chars or fewer.`);
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(value.slice(prefix.length))) {
    throw new Error(`${field} contains unsupported characters.`);
  }
}

function safeTimestamp(value: Date): string {
  return value.toISOString().replace(/[^A-Za-z0-9._:-]/g, "_");
}
