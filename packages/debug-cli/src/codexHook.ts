import { stdin } from "node:process";
import type { Readable } from "node:stream";
import type {
  RuntimeDescriptor,
  WorkflowEventWire,
  WorkflowSource
} from "@ai-partner/contracts";
import type { DiscoverRuntimeOptions } from "./discovery.js";
import { discoverRuntime } from "./discovery.js";
import { DebugCliError } from "./errors.js";
import type { SendWorkflowEventOptions, SendWorkflowEventResult } from "./sender.js";
import { sendWorkflowEvent } from "./sender.js";
import type { DebugWorkflowState } from "./constants.js";
import { createWorkflowEvent } from "./workflowEvent.js";

export const codexHookEventNames = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop"
] as const;

export type CodexHookEventName = (typeof codexHookEventNames)[number];

export interface CodexHookSignal {
  eventName: CodexHookEventName;
  state: DebugWorkflowState;
  runId: string;
  message: string;
  contextPath?: string;
}

export interface SendCodexHookEventOptions {
  eventName?: string;
  input?: unknown;
  descriptorPath?: string;
  postTimeoutMs?: number;
  strict?: boolean;
  timestamp?: Date;
  cwd?: string;
  discover?: (options: DiscoverRuntimeOptions) => Promise<RuntimeDescriptor>;
  send?: (
    descriptor: RuntimeDescriptor,
    event: WorkflowEventWire,
    options: SendWorkflowEventOptions
  ) => Promise<SendWorkflowEventResult>;
}

const source = "codex-hook" as const satisfies WorkflowSource;

export async function sendCodexHookEvent(
  options: SendCodexHookEventOptions = {}
): Promise<WorkflowEventWire | undefined> {
  try {
    const input = options.input ?? await readHookInput();
    const signal = createCodexHookSignal(input, {
      eventName: options.eventName,
      timestamp: options.timestamp,
      cwd: options.cwd ?? process.cwd()
    });

    if (signal === undefined) {
      return undefined;
    }

    const descriptor = await (options.discover ?? discoverRuntime)({
      descriptorPath: options.descriptorPath,
      skipEndpointCheck: true
    });
    const event = createWorkflowEvent({
      state: signal.state,
      runId: signal.runId,
      message: signal.message,
      source,
      timestamp: options.timestamp,
      contextPath: signal.contextPath
    });
    const sendOptions: SendWorkflowEventOptions = { allowedSources: [source] };
    if (options.postTimeoutMs !== undefined) {
      sendOptions.timeoutMs = options.postTimeoutMs;
    }
    await (options.send ?? sendWorkflowEvent)(descriptor, event, sendOptions);
    return event;
  } catch (error) {
    if (options.strict) {
      throw error;
    }
    debugLog(error);
    return undefined;
  }
}

export function createCodexHookSignal(
  input: unknown,
  options: { eventName?: string; timestamp?: Date; cwd?: string } = {}
): CodexHookSignal | undefined {
  const record = asRecord(input);
  const eventName = normalizeCodexHookEventName(
    options.eventName ??
      readString(record, "hook_event_name") ??
      readString(record, "hookEventName") ??
      readString(record, "event")
  );

  if (eventName === undefined) {
    return undefined;
  }

  return {
    eventName,
    state: stateForCodexHookEvent(eventName, record),
    runId: runIdForCodexHook(record, options.timestamp),
    message: messageForCodexHookEvent(eventName, record),
    contextPath: contextPathForCodexHook(record, options.cwd)
  };
}

export function normalizeCodexHookEventName(value: string | undefined): CodexHookEventName | undefined {
  if (value === undefined) {
    return undefined;
  }
  const key = value.replace(/[-_\s]/g, "").toLowerCase();
  for (const eventName of codexHookEventNames) {
    if (eventName.toLowerCase() === key) {
      return eventName;
    }
  }
  return undefined;
}

async function readHookInput(readable: Readable = stdin): Promise<unknown> {
  if ((readable as Readable & { isTTY?: boolean }).isTTY === true) {
    return {};
  }
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new DebugCliError("Codex hook stdin was not valid JSON.", "invalid_event");
  }
}

function stateForCodexHookEvent(
  eventName: CodexHookEventName,
  input: Record<string, unknown>
): DebugWorkflowState {
  switch (eventName) {
    case "PreToolUse":
      return stateForToolName(readString(input, "tool_name") ?? readString(input, "toolName"));
    case "PermissionRequest":
      return "waiting";
    case "PostToolUse":
      return hookPayloadLooksFailed(input) ? "error" : "running";
    case "Stop":
      return hookPayloadLooksFailed(input) ? "error" : "done";
    case "SessionStart":
    case "UserPromptSubmit":
    case "PreCompact":
    case "PostCompact":
    case "SubagentStart":
    case "SubagentStop":
      return "running";
  }
}

function stateForToolName(toolName: string | undefined): DebugWorkflowState {
  if (toolName === undefined) {
    return "running";
  }
  const normalized = toolName.toLowerCase();
  if (/(apply_patch|write|edit|multiedit|patch)/.test(normalized)) {
    return "editing";
  }
  if (/(read|list|find|grep|rg|search|open|view|cat|sed|ls)/.test(normalized)) {
    return "reading";
  }
  return "running";
}

function messageForCodexHookEvent(
  eventName: CodexHookEventName,
  input: Record<string, unknown>
): string {
  const state = stateForCodexHookEvent(eventName, input);
  switch (state) {
    case "reading":
      return "Codex is reading";
    case "editing":
      return "Codex is editing";
    case "waiting":
      return "Codex is waiting for approval";
    case "done":
      return "Codex turn completed";
    case "error":
      return "Codex turn needs attention";
    case "running":
      return "Codex is running";
  }
}

function hookPayloadLooksFailed(input: Record<string, unknown>): boolean {
  const status = readString(input, "status") ?? readString(input, "result");
  if (status !== undefined && /^(error|failed|failure)$/i.test(status)) {
    return true;
  }
  return Boolean(input.error);
}

function runIdForCodexHook(input: Record<string, unknown>, timestamp = new Date()): string {
  const candidate =
    readString(input, "turn_id") ??
    readString(input, "turnId") ??
    readString(input, "session_id") ??
    readString(input, "sessionId") ??
    timestamp.toISOString();
  return `run_codex_hook_${sanitizeIdPart(candidate)}`;
}

function contextPathForCodexHook(
  input: Record<string, unknown>,
  cwd: string | undefined
): string | undefined {
  return normalizeContextPath(
    readString(input, "cwd") ??
      readString(input, "current_working_directory") ??
      readString(input, "currentWorkingDirectory") ??
      readString(input, "workspace") ??
      cwd
  );
}

function normalizeContextPath(value: string | undefined): string | undefined {
  if (value === undefined || value.includes("\n") || value.includes("\r")) {
    return undefined;
  }
  if ([...value].length <= 240) {
    return value;
  }
  return `...${[...value].slice(-237).join("")}`;
}

function sanitizeIdPart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "_").replace(/_+/g, "_");
  return sanitized.slice(0, 105) || "unknown";
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function debugLog(error: unknown): void {
  if (process.env.AI_PARTNER_HOOK_DEBUG !== "1") {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-partner codex hook skipped: ${message}`);
}
