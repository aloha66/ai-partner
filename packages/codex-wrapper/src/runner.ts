import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { RuntimeDescriptor, WorkflowEventWire } from "@ai-partner/contracts";
import {
  asDebugCliError,
  discoverRuntime,
  sendWorkflowEvent,
  type DiscoverRuntimeOptions,
  type SendWorkflowEventOptions
} from "@ai-partner/debug-cli";
import {
  classifyCodexExit,
  classifyCodexLine,
  type CodexClassifierSignal,
  type CodexWrapperWorkflowState
} from "./classifier.js";
import { createCodexRunId, createCodexWorkflowEvent } from "./workflowEvent.js";

export interface CodexWrapperRunOptions {
  codexCommand?: string;
  codexArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  descriptorPath?: string;
  runId?: string;
  stdout?: Writable;
  stderr?: Writable;
  discover?: (options: DiscoverRuntimeOptions) => Promise<RuntimeDescriptor>;
  send?: (
    descriptor: RuntimeDescriptor,
    event: WorkflowEventWire,
    options: SendWorkflowEventOptions
  ) => Promise<unknown>;
  spawnCodex?: (command: string, args: string[], options: SpawnOptions) => CodexChild;
  onClassifierSignal?: (signal: CodexClassifierSignal) => void;
}

export interface CodexChild {
  stdout: Readable;
  stderr: Readable;
  on(
    event: "exit" | "error",
    listener:
      | ((code: number | null, signal: NodeJS.Signals | null) => void)
      | ((error: Error) => void)
  ): this;
}

const allowedWrapperSources = ["codex-wrapper"] as const;

export async function runCodexWrapper(options: CodexWrapperRunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const descriptor = await (options.discover ?? discoverRuntime)({
    descriptorPath: options.descriptorPath
  });
  const runId = options.runId ?? createCodexRunId();
  const send = options.send ?? sendWorkflowEvent;

  let lastSentState: CodexWrapperWorkflowState | undefined;
  let eventFailure: Error | undefined;
  let sendQueue = Promise.resolve();

  const enqueueState = (signal: CodexClassifierSignal): void => {
    options.onClassifierSignal?.(signal);
    if (signal.state === lastSentState) {
      return;
    }
    lastSentState = signal.state;
    const event = createCodexWorkflowEvent({
      state: signal.state,
      runId
    });
    sendQueue = sendQueue
      .then(() =>
        send(descriptor, event, {
          allowedSources: allowedWrapperSources
        })
      )
      .then(
        () => undefined,
        (error: unknown) => {
          eventFailure = error instanceof Error ? error : new Error(String(error));
        }
      );
  };

  enqueueState({
    state: "running",
    kind: "structured",
    matcher: "wrapper.start",
    confidence: "high"
  });
  await sendQueue;
  if (eventFailure !== undefined) {
    throw eventFailure;
  }

  const child = (options.spawnCodex ?? defaultSpawnCodex)(
    options.codexCommand ?? "codex",
    options.codexArgs ?? [],
    {
      cwd: options.cwd,
      env: options.env,
      stdio: ["inherit", "pipe", "pipe"]
    }
  );

  const stdoutDone = pipeAndClassify(child.stdout, stdout, enqueueState);
  const stderrDone = pipeAndClassify(child.stderr, stderr, enqueueState);

  const exit = await waitForChildExit(child);
  await Promise.all([stdoutDone, stderrDone]);
  enqueueState(classifyCodexExit(exit.code, exit.signal));
  await sendQueue;

  if (eventFailure !== undefined) {
    const debugError = asDebugCliError(eventFailure);
    stderr.write(`ai-partner event bridge failed: ${debugError.code}\n`);
  }

  if (exit.signal !== null) {
    return 1;
  }
  return exit.code ?? 1;
}

function defaultSpawnCodex(
  command: string,
  args: string[],
  options: SpawnOptions
): CodexChild {
  const child = spawn(command, args, options);
  if (child.stdout === null || child.stderr === null) {
    throw new Error("Codex child process must expose stdout and stderr streams.");
  }

  return {
    stdout: child.stdout,
    stderr: child.stderr,
    on(event: "exit" | "error", listener: (...args: unknown[]) => void) {
      if (event === "exit") {
        child.on("exit", listener as (code: number | null, signal: NodeJS.Signals | null) => void);
      } else {
        child.on("error", listener as (error: Error) => void);
      }
      return this;
    }
  };
}

function pipeAndClassify(
  input: Readable,
  output: Writable,
  onSignal: (signal: CodexClassifierSignal) => void
): Promise<void> {
  let buffered = "";

  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (buffered.length > 0) {
        onSignal(classifyCodexLine(buffered));
        buffered = "";
      }
      resolve();
    };

    input.on("data", (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      output.write(chunk);
      buffered += text;

      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        onSignal(classifyCodexLine(line));
      }
    });

    input.on("end", finish);
    input.on("close", finish);
    input.on("error", finish);
  });
}

function waitForChildExit(
  child: CodexChild
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    let settled = false;
    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ code, signal });
    });
    child.on("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ code: 1, signal: null });
    });
  });
}
