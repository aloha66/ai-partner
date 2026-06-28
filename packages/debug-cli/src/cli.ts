#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import type { DiscoverRuntimeOptions } from "./discovery.js";
import {
  debugWorkflowStates,
  defaultConnectTimeoutMs,
  defaultRuntimeDescriptorPath,
  discoverRuntime,
  createRunId,
  createWorkflowEvent,
  readDebugSessionRunId,
  isDebugWorkflowState,
  sendWorkflowEvent,
  sendCodexHookEvent,
  togglePartner,
  writeDebugSessionRunId
} from "./index.js";
import { asDebugCliError, DebugCliError } from "./errors.js";
import type { WorkflowSource } from "@ai-partner/contracts";

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

const forbiddenFlags = new Set([
  "clipboard",
  "code",
  "diff",
  "file",
  "file-content",
  "fileContent",
  "prompt",
  "screen-text",
  "screenText"
]);

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  rejectForbiddenFlags(args.flags);

  switch (args.command) {
    case "discover":
      await runDiscover(args);
      return;
    case "send":
      await runSend(args);
      return;
    case "sequence":
      await runSequence(args);
      return;
    case "partner":
      await runPartner(args);
      return;
    case "codex-hook":
      await runCodexHook(args);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new DebugCliError(`Unknown command: ${args.command || "(missing)"}`, "usage");
  }
}

async function runPartner(args: ParsedArgs): Promise<void> {
  const result = await togglePartner({
    appPath: readOptionalFlag(args, "app-path"),
    descriptorPath: readOptionalFlag(args, "descriptor"),
    connectTimeoutMs: readNumberFlag(args, "connect-timeout-ms", defaultConnectTimeoutMs),
    postTimeoutMs: readNumberFlag(args, "post-timeout-ms", undefined)
  });
  if (result.action === "started") {
    console.log(`partner started app="${result.appPath}" descriptor="${result.descriptorPath}"`);
  } else {
    console.log(`partner stopped descriptor="${result.descriptorPath}"`);
  }
}

async function runCodexHook(args: ParsedArgs): Promise<void> {
  await sendCodexHookEvent({
    eventName: readOptionalFlag(args, "event"),
    descriptorPath: readOptionalFlag(args, "descriptor"),
    postTimeoutMs: readNumberFlag(args, "post-timeout-ms", undefined),
    strict: args.flags.has("strict")
  });
}

async function runDiscover(args: ParsedArgs): Promise<void> {
  const descriptor = await discoverRuntime(discoverOptions(args));
  console.log(
    `ok endpoint=http://127.0.0.1:${descriptor.port}/events appInstanceId=${descriptor.appInstanceId} pid=${descriptor.pid} createdAt=${descriptor.createdAt}`
  );
}

async function runSend(args: ParsedArgs): Promise<void> {
  const state = args.positional[0];
  if (!state || !isDebugWorkflowState(state)) {
    throw new DebugCliError(
      `send requires one state: ${debugWorkflowStates.join(", ")}`,
      "usage"
    );
  }

  const descriptor = await discoverRuntime(discoverOptions(args, { skipEndpointCheck: true }));
  const explicitRunId = readOptionalFlag(args, "run-id");
  const event = createWorkflowEvent({
    state,
    runId: explicitRunId ?? await defaultRunIdForSend(state),
    message: readOptionalFlag(args, "message"),
    source: readWorkflowSource(args),
    cardTitle: readOptionalFlag(args, "card-title"),
    contextPath: readOptionalFlag(args, "context-path"),
    authorization: readAuthorization(args)
  });
  await sendWorkflowEvent(descriptor, event, {
    ...sendOptions(args),
    allowedSources: [event.source]
  });
  await rememberRunIdForSend(state, event.run_id, explicitRunId);
  console.log(`sent ${event.workflow_state} run_id=${event.run_id} event_id=${event.event_id}`);
}

async function runSequence(args: ParsedArgs): Promise<void> {
  const descriptor = await discoverRuntime(discoverOptions(args, { skipEndpointCheck: true }));
  const runId = readOptionalFlag(args, "run-id") ?? createRunId();
  const delayMs = readNumberFlag(args, "delay-ms", 500);

  for (const state of debugWorkflowStates) {
    const event = createWorkflowEvent({
      state,
      runId,
      message: readOptionalFlag(args, "message"),
      source: readWorkflowSource(args),
      cardTitle: readOptionalFlag(args, "card-title"),
      contextPath: readOptionalFlag(args, "context-path")
    });
    await sendWorkflowEvent(descriptor, event, {
      ...sendOptions(args),
      allowedSources: [event.source]
    });
    console.log(`sent ${event.workflow_state} run_id=${event.run_id} event_id=${event.event_id}`);
    if (state !== debugWorkflowStates[debugWorkflowStates.length - 1]) {
      await sleep(delayMs);
    }
  }
}

export function discoverOptions(
  args: ParsedArgs,
  overrides: { skipEndpointCheck?: boolean } = {}
): DiscoverRuntimeOptions {
  return {
    descriptorPath: readOptionalFlag(args, "descriptor"),
    connectTimeoutMs: readNumberFlag(args, "connect-timeout-ms", defaultConnectTimeoutMs),
    maxAgeMs: readNumberFlag(args, "max-age-ms", undefined),
    futureSkewMs: readNumberFlag(args, "future-skew-ms", undefined),
    skipEndpointCheck: overrides.skipEndpointCheck
  };
}

function sendOptions(args: ParsedArgs) {
  return {
    timeoutMs: readNumberFlag(args, "post-timeout-ms", undefined)
  };
}

async function defaultRunIdForSend(state: string): Promise<string | undefined> {
  if (state === "done" || state === "error") {
    return readDebugSessionRunId();
  }
  return undefined;
}

async function rememberRunIdForSend(
  state: string,
  runId: string,
  explicitRunId: string | undefined
): Promise<void> {
  if (explicitRunId !== undefined || state === "done" || state === "error") {
    return;
  }
  await writeDebugSessionRunId(runId);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const flag = arg.slice(2);
    const equalsIndex = flag.indexOf("=");
    if (equalsIndex >= 0) {
      flags.set(flag.slice(0, equalsIndex), flag.slice(equalsIndex + 1));
      continue;
    }

    const key = flag;
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }

  return { command, positional, flags };
}

function rejectForbiddenFlags(flags: Map<string, string | true>): void {
  for (const key of flags.keys()) {
    if (forbiddenFlags.has(key)) {
      throw new DebugCliError(`Refusing forbidden code-context flag --${key}.`, "unsafe_payload");
    }
  }
}

function readOptionalFlag(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags.get(key);
  if (value === undefined) {
    return undefined;
  }
  if (value === true) {
    throw new DebugCliError(`--${key} requires a value.`, "usage");
  }
  return value;
}

function readWorkflowSource(args: ParsedArgs): WorkflowSource | undefined {
  const source = readOptionalFlag(args, "source");
  if (source === undefined) {
    return undefined;
  }
  if (!["cli", "codex-wrapper", "demo-script", "claude-hook", "codex-hook"].includes(source)) {
    throw new DebugCliError("--source must be cli, codex-wrapper, demo-script, claude-hook, or codex-hook.", "usage");
  }
  return source as WorkflowSource;
}

function readAuthorization(args: ParsedArgs) {
  const id = readOptionalFlag(args, "auth-id");
  const description = readOptionalFlag(args, "auth-description");
  if (id === undefined && description === undefined) {
    return undefined;
  }
  if (id === undefined || description === undefined) {
    throw new DebugCliError("--auth-id and --auth-description must be provided together.", "usage");
  }
  const kind = readOptionalFlag(args, "auth-kind") ?? "command";
  if (!["command", "tool"].includes(kind)) {
    throw new DebugCliError("--auth-kind must be command or tool.", "usage");
  }
  const status = readOptionalFlag(args, "auth-status") ?? "pending";
  if (!["pending", "allowed", "denied"].includes(status)) {
    throw new DebugCliError("--auth-status must be pending, allowed, or denied.", "usage");
  }
  const decidedAt = readOptionalFlag(args, "auth-decided-at");
  return {
    kind: kind as "command" | "tool",
    id,
    title: readOptionalFlag(args, "auth-title"),
    description,
    status: status as "pending" | "allowed" | "denied",
    ...(decidedAt === undefined ? {} : { decidedAt })
  };
}

function readNumberFlag(args: ParsedArgs, key: string, fallback: number): number;
function readNumberFlag(args: ParsedArgs, key: string, fallback: undefined): number | undefined;
function readNumberFlag(args: ParsedArgs, key: string, fallback: number | undefined) {
  const value = args.flags.get(key);
  if (value === undefined) {
    return fallback;
  }
  if (value === true) {
    throw new DebugCliError(`--${key} requires a number.`, "usage");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DebugCliError(`--${key} must be a non-negative number.`, "usage");
  }
  return parsed;
}

function printHelp(): void {
  console.log(`ai-partner-debug

Usage:
  ai-partner-debug discover [--descriptor path]
  ai-partner-debug partner [--app-path path] [--descriptor path]
  ai-partner-debug codex-hook [--event PreToolUse] [--descriptor path]
  ai-partner-debug send <state> [--message text] [--run-id run_id] [--context-path path] [--auth-id auth_id --auth-description text] [--auth-status pending|allowed|denied]
  ai-partner-debug sequence [--delay-ms 500] [--run-id run_id]

States:
  ${debugWorkflowStates.join(", ")}

Default descriptor:
  ${defaultRuntimeDescriptorPath()}
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const debugError = asDebugCliError(error);
    console.error(`${debugError.code}: ${debugError.message}`);
    process.exitCode = debugError.code === "usage" ? 2 : 1;
  });
}
