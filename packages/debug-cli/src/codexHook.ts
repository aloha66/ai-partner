import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mkdir,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  cacheDir?: string;
  discover?: (options: DiscoverRuntimeOptions) => Promise<RuntimeDescriptor>;
  send?: (
    descriptor: RuntimeDescriptor,
    event: WorkflowEventWire,
    options: SendWorkflowEventOptions
  ) => Promise<SendWorkflowEventResult>;
}

const source = "codex-hook" as const satisfies WorkflowSource;
const defaultHookRunCacheDir = join(tmpdir(), "ai-partner-codex-hook-runs");

export async function sendCodexHookEvent(
  options: SendCodexHookEventOptions = {}
): Promise<WorkflowEventWire | undefined> {
  try {
    const input = options.input ?? await readHookInput();
    const signal = createCodexHookSignal(input, {
      eventName: options.eventName,
      timestamp: options.timestamp,
      cwd: options.cwd ?? process.cwd(),
      cacheDir: options.cacheDir
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
    await rememberCodexHookRun(input, signal, options.cwd ?? process.cwd(), options.cacheDir).catch(debugLog);
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
  options: { eventName?: string; timestamp?: Date; cwd?: string; cacheDir?: string } = {}
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

  if (isCompanionLifecycleNoise(eventName, record)) {
    return undefined;
  }

  return {
    eventName,
    state: stateForCodexHookEvent(eventName, record),
    runId: runIdForCodexHook(record, eventName, options.timestamp, options.cwd, options.cacheDir),
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
  if (eventName === "PreToolUse") {
    return activityMessageForToolName(readString(input, "tool_name") ?? readString(input, "toolName"));
  }

  const state = stateForCodexHookEvent(eventName, input);
  switch (state) {
    case "reading":
      return "正在读取项目文件";
    case "editing":
      return "正在写入项目内容";
    case "waiting":
      return "正在等待授权";
    case "done":
      return "本轮任务已完成";
    case "error":
      return "任务需要处理";
    case "running":
      return "正在处理任务";
  }
}

function activityMessageForToolName(toolName: string | undefined): string {
  if (toolName === undefined) {
    return "正在处理任务";
  }

  const normalized = toolName.toLowerCase();
  if (/(apply_patch|write|edit|multiedit|patch)/.test(normalized)) {
    return "正在写入项目内容";
  }
  if (/(web|search|fetch|query|scrape|browse)/.test(normalized)) {
    return "正在查询资料";
  }
  if (/(read|list|find|grep|rg|open|view|cat|sed|ls)/.test(normalized)) {
    return "正在读取项目文件";
  }
  if (/(exec|shell|command|terminal)/.test(normalized)) {
    return "正在运行本地命令";
  }
  return "正在处理任务";
}

function isCompanionLifecycleNoise(
  eventName: CodexHookEventName,
  input: Record<string, unknown>
): boolean {
  if (eventName === "SubagentStart" || eventName === "SubagentStop") {
    return true;
  }
  return eventName === "PostToolUse" && !hookPayloadLooksFailed(input);
}

function hookPayloadLooksFailed(input: Record<string, unknown>): boolean {
  const status = readString(input, "status") ?? readString(input, "result");
  if (status !== undefined && /^(error|failed|failure)$/i.test(status)) {
    return true;
  }
  return Boolean(input.error);
}

function runIdForCodexHook(
  input: Record<string, unknown>,
  eventName: CodexHookEventName,
  timestamp = new Date(),
  cwd?: string,
  cacheDir?: string
): string {
  const explicitTurn =
    readString(input, "run_id") ??
    readString(input, "runId") ??
    readString(input, "turn_id") ??
    readString(input, "turnId");
  if (explicitTurn !== undefined) {
    return `run_codex_hook_${sanitizeIdPart(explicitTurn)}`;
  }

  if (eventName === "Stop") {
    const remembered = readRememberedCodexHookRunSync(input, cwd, cacheDir);
    if (remembered !== undefined) {
      return remembered;
    }
  }

  const candidate =
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

async function rememberCodexHookRun(
  input: unknown,
  signal: CodexHookSignal,
  cwd: string,
  cacheDir?: string
): Promise<void> {
  if (!shouldRememberRun(signal.eventName)) {
    return;
  }
  const cachePaths = cachePathsForRememberedHookRun(asRecord(input), cwd, cacheDir);
  if (cachePaths.length === 0) {
    return;
  }
  await mkdir(cacheRoot(cacheDir), { recursive: true });
  const payload = JSON.stringify({
    runId: signal.runId,
    updatedAt: new Date().toISOString()
  });
  await Promise.all(cachePaths.map((cachePath) => writeFile(cachePath, payload, "utf8")));
}

function shouldRememberRun(eventName: CodexHookEventName): boolean {
  return eventName !== "Stop";
}

function readRememberedCodexHookRunSync(
  input: Record<string, unknown>,
  cwd: string | undefined,
  cacheDir?: string
): string | undefined {
  for (const cachePath of cachePathsForReadableHookRun(input, cwd, cacheDir)) {
    try {
      const payload = JSON.parse(readFileSync(cachePath, "utf8")) as unknown;
      const record = asRecord(payload);
      if (Object.keys(record).length === 0) {
        continue;
      }
      const runId = readString(record, "runId");
      if (runId !== undefined) {
        return runId;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function cachePathsForRememberedHookRun(
  input: Record<string, unknown>,
  cwd: string | undefined,
  cacheDir?: string
): string[] {
  return uniqueCachePaths([
    cachePathForHookInput(input, cwd, cacheDir),
    cachePathForHookSession(input, cacheDir),
    cachePathForHookContext(input, cwd, cacheDir)
  ]);
}

function cachePathsForReadableHookRun(
  input: Record<string, unknown>,
  cwd: string | undefined,
  cacheDir?: string
): string[] {
  return cachePathsForRememberedHookRun(input, cwd, cacheDir);
}

function cachePathForHookInput(
  input: Record<string, unknown>,
  cwd: string | undefined,
  cacheDir?: string
): string | undefined {
  const session = sessionKeyForHookInput(input);
  if (session === undefined) {
    return undefined;
  }
  const context = contextPathForCodexHook(input, cwd) ?? "";
  const key = createHash("sha256")
    .update(`${session}\0${context}`)
    .digest("hex")
    .slice(0, 40);
  return join(cacheRoot(cacheDir), `${key}.json`);
}

function cachePathForHookSession(
  input: Record<string, unknown>,
  cacheDir?: string
): string | undefined {
  const session = sessionKeyForHookInput(input);
  if (session === undefined) {
    return undefined;
  }
  const key = scopedCacheKey("session", session);
  return join(cacheRoot(cacheDir), `${key}.json`);
}

function cachePathForHookContext(
  input: Record<string, unknown>,
  cwd: string | undefined,
  cacheDir?: string
): string | undefined {
  const context = contextPathForCodexHook(input, cwd);
  if (context === undefined) {
    return undefined;
  }
  const key = scopedCacheKey("context", context);
  return join(cacheRoot(cacheDir), `${key}.json`);
}

function sessionKeyForHookInput(input: Record<string, unknown>): string | undefined {
  return (
    readString(input, "session_id") ??
    readString(input, "sessionId") ??
    readString(input, "conversation_id") ??
    readString(input, "conversationId")
  );
}

function scopedCacheKey(scope: string, value: string): string {
  return createHash("sha256")
    .update(`${scope}\0${value}`)
    .digest("hex")
    .slice(0, 40);
}

function uniqueCachePaths(paths: Array<string | undefined>): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (path === undefined || seen.has(path)) {
      continue;
    }
    seen.add(path);
    unique.push(path);
  }
  return unique;
}

function cacheRoot(cacheDir: string | undefined): string {
  return cacheDir ?? defaultHookRunCacheDir;
}

function debugLog(error: unknown): void {
  if (process.env.AI_PARTNER_HOOK_DEBUG !== "1") {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-partner codex hook skipped: ${message}`);
}
