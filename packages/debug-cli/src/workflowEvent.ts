import { randomUUID } from "node:crypto";
import type {
  WorkflowAuthorization,
  WorkflowEventWire,
  WorkflowSource
} from "@ai-partner/contracts";
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
  source?: WorkflowSource;
  cardTitle?: string;
  contextPath?: string;
  authorization?: WorkflowAuthorization;
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
  const cardTitle = normalizeShortText(options.cardTitle, "card title", 80);
  const contextPath = normalizeShortText(options.contextPath, "context path", 240);
  const authorization = normalizeAuthorization(options.authorization);
  return {
    schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
    event_id: eventId,
    source: options.source ?? "cli",
    run_id: runId,
    workflow_state: options.state,
    timestamp: (options.timestamp ?? new Date()).toISOString(),
    ...(message === undefined ? {} : { message }),
    ...(cardTitle === undefined ? {} : { card_title: cardTitle }),
    ...(contextPath === undefined ? {} : { context_path: contextPath }),
    ...(authorization === undefined ? {} : { authorization }),
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

function normalizeShortText(
  value: string | undefined,
  label: string,
  maxLength: number
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.includes("\n") || value.includes("\r")) {
    throw new DebugCliError(`Workflow event ${label} must not contain newlines.`, "invalid_message");
  }
  if ([...value].length > maxLength) {
    throw new DebugCliError(`Workflow event ${label} must be ${maxLength} characters or fewer.`, "invalid_message");
  }
  if (value.length === 0) {
    throw new DebugCliError(`Workflow event ${label} must not be empty.`, "invalid_message");
  }
  return value;
}

export function normalizeAuthorization(
  authorization: WorkflowAuthorization | undefined
): WorkflowAuthorization | undefined {
  if (authorization === undefined) {
    return undefined;
  }
  if (!["command", "tool"].includes(authorization.kind)) {
    throw new DebugCliError("Workflow authorization kind is unsupported.", "invalid_authorization");
  }
  assertContractId(authorization.id, "auth_", "authorization.id");
  const title = normalizeShortText(authorization.title, "authorization title", 80);
  const description = normalizeShortText(
    authorization.description,
    "authorization description",
    160
  );
  if (!["pending", "allowed", "denied"].includes(authorization.status)) {
    throw new DebugCliError("Workflow authorization status is unsupported.", "invalid_authorization");
  }
  return {
    kind: authorization.kind,
    id: authorization.id,
    ...(title === undefined ? {} : { title }),
    description: description ?? authorization.description,
    status: authorization.status,
    ...(authorization.decidedAt === undefined ? {} : { decidedAt: authorization.decidedAt })
  };
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
