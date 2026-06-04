import { randomUUID } from "node:crypto";
import type { WorkflowEventWire } from "@ai-partner/contracts";
import {
  debugWorkflowStates,
  forbiddenWorkflowPayloadFields,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  type DebugWorkflowState
} from "./constants.js";
import { DebugCliError } from "./errors.js";

export interface CreateWorkflowEventOptions {
  state: DebugWorkflowState;
  runId?: string;
  eventId?: string;
  timestamp?: Date;
  message?: string;
}

export function createWorkflowEvent(options: CreateWorkflowEventOptions): WorkflowEventWire {
  if (!isDebugWorkflowState(options.state)) {
    throw new DebugCliError(`Unsupported debug workflow state: ${options.state}`, "invalid_state");
  }

  const runId = options.runId ?? createRunId();
  const eventId = options.eventId ?? createEventId(options.state);
  assertContractId(runId, "run_", "run_id");
  assertContractId(eventId, "evt_", "event_id");

  const message = normalizeMessage(options.message);
  return {
    schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
    event_id: eventId,
    source: "cli",
    run_id: runId,
    workflow_state: options.state,
    timestamp: (options.timestamp ?? new Date()).toISOString(),
    ...(message === undefined ? {} : { message }),
    code_context_allowed: false
  };
}

export function createRunId(now = new Date()): string {
  return `run_debug_${safeTimestamp(now)}_${randomUUID()}`;
}

export function createEventId(state: DebugWorkflowState, now = new Date()): string {
  return `evt_debug_${state}_${safeTimestamp(now)}_${randomUUID()}`;
}

export function isDebugWorkflowState(value: string): value is DebugWorkflowState {
  return debugWorkflowStates.includes(value as DebugWorkflowState);
}

export function assertNoForbiddenFields(payload: unknown): void {
  if (!hasForbiddenField(payload)) {
    return;
  }
  throw new DebugCliError("Workflow payload contains a forbidden code-context field.", "unsafe_payload");
}

export function hasForbiddenField(payload: unknown): boolean {
  if (Array.isArray(payload)) {
    return payload.some(hasForbiddenField);
  }
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  for (const [key, value] of Object.entries(payload)) {
    if ((forbiddenWorkflowPayloadFields as readonly string[]).includes(key)) {
      return true;
    }
    if (hasForbiddenField(value)) {
      return true;
    }
  }
  return false;
}

export function normalizeMessage(message: string | undefined): string | undefined {
  if (message === undefined) {
    return undefined;
  }
  if (message.includes("\n") || message.includes("\r")) {
    throw new DebugCliError("Workflow event message must not contain newlines.", "invalid_message");
  }
  if ([...message].length > 160) {
    throw new DebugCliError("Workflow event message must be 160 characters or fewer.", "invalid_message");
  }
  return message;
}

function assertContractId(value: string, prefix: string, field: string): void {
  if (value.length > 120 || !value.startsWith(prefix) || value.length === prefix.length) {
    throw new DebugCliError(`${field} must start with ${prefix} and be 120 chars or fewer.`, "invalid_id");
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(value.slice(prefix.length))) {
    throw new DebugCliError(`${field} contains unsupported characters.`, "invalid_id");
  }
}

function safeTimestamp(value: Date): string {
  return value.toISOString().replace(/[^A-Za-z0-9._:-]/g, "_");
}
