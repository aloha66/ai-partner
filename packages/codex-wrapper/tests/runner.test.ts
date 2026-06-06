import { PassThrough, Writable } from "node:stream";
import type { SpawnOptions } from "node:child_process";
import type { WorkflowEventWire } from "@ai-partner/contracts";
import type { RuntimeDescriptor } from "@ai-partner/contracts";
import type { SendWorkflowEventOptions } from "@ai-partner/debug-cli";
import { describe, expect, it } from "vitest";
import { runCodexWrapper, type CodexChild } from "../src";

class MemoryWritable extends Writable {
  chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

describe("Codex wrapper runner", () => {
  it("forwards process output but posts only safe workflow events", async () => {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const posted: WorkflowEventWire[] = [];
    const sendOptions: SendWorkflowEventOptions[] = [];
    const child = createFakeChild();
    let resolveSpawned: () => void = () => undefined;
    const spawned = new Promise<void>((resolve) => {
      resolveSpawned = resolve;
    });

    const result = runCodexWrapper({
      codexArgs: ["exec", "--json", "secret prompt must stay local"],
      runId: "run_codex_runner_test",
      stdout,
      stderr,
      discover: async () => runtimeDescriptor(),
      send: async (_descriptor, event, options) => {
        posted.push(event);
        sendOptions.push(options);
      },
      spawnCodex: (_command: string, _args: string[], _options: SpawnOptions) => {
        resolveSpawned();
        return child;
      }
    });

    await spawned;
    child.stdout.write('{"workflow_state":"reading","prompt":"SECRET PROMPT"}\n');
    child.stderr.write("patch applied to secret file content\n");
    child.stdout.end();
    child.stderr.end();
    child.exit(0, null);
    await result;

    expect(stdout.text()).toContain("SECRET PROMPT");
    expect(posted.map((event) => event.workflow_state)).toEqual([
      "running",
      "reading",
      "editing",
      "done"
    ]);
    expect(sendOptions).toHaveLength(posted.length);
    for (const options of sendOptions) {
      expect(options.allowedSources).toEqual(["codex-wrapper"]);
    }
    for (const event of posted) {
      expect(event).toMatchObject({
        source: "codex-wrapper",
        run_id: "run_codex_runner_test",
        code_context_allowed: false
      });
      expect(JSON.stringify(event)).not.toContain("SECRET PROMPT");
      expect(JSON.stringify(event)).not.toContain("secret file content");
      expect(Object.keys(event).sort()).toEqual([
        "code_context_allowed",
        "event_id",
        "message",
        "run_id",
        "schemaVersion",
        "source",
        "timestamp",
        "workflow_state"
      ]);
    }
  });

  it("maps non-zero Codex exit to error", async () => {
    const posted: WorkflowEventWire[] = [];
    const child = createFakeChild();
    let resolveSpawned: () => void = () => undefined;
    const spawned = new Promise<void>((resolve) => {
      resolveSpawned = resolve;
    });

    const result = runCodexWrapper({
      runId: "run_codex_error_test",
      stdout: new MemoryWritable(),
      stderr: new MemoryWritable(),
      discover: async () => runtimeDescriptor(),
      send: async (_descriptor, event) => {
        posted.push(event);
      },
      spawnCodex: () => {
        resolveSpawned();
        return child;
      }
    });

    await spawned;
    child.exit(7, null);

    await expect(result).resolves.toBe(7);
    expect(posted.map((event) => event.workflow_state)).toEqual(["running", "error"]);
  });
});

function createFakeChild(): CodexChild & {
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  return {
    stdout,
    stderr,
    on(event: "exit" | "error", listener: (...args: unknown[]) => void) {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
      return this;
    },
    exit(code: number | null, signal: NodeJS.Signals | null) {
      stdout.end();
      stderr.end();
      for (const listener of listeners.get("exit") ?? []) {
        listener(code, signal);
      }
    }
  };
}

function runtimeDescriptor(): RuntimeDescriptor {
  return {
    schemaVersion: "ai-partner.runtime-descriptor.v1",
    appInstanceId: "app_codex_wrapper_test",
    pid: process.pid,
    port: 43172,
    token: "test_runtime_token_1234567890",
    createdAt: "2026-06-03T00:00:00Z"
  };
}
