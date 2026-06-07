import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeDescriptor } from "@ai-partner/contracts";
import { describe, expect, it } from "vitest";
import {
  DebugCliError,
  RUNTIME_DESCRIPTOR_SCHEMA_VERSION,
  assertNoForbiddenFields,
  createWorkflowEventRequestOptions,
  debugWorkflowStates,
  discoverRuntime,
  readRuntimeDescriptor,
  sendWorkflowEvent,
  createWorkflowEvent,
  readDebugSessionRunId,
  writeDebugSessionRunId,
  validateRuntimeDescriptorFreshness
} from "../src";
import { parseArgs } from "../src/cli";

describe("CLI args", () => {
  it("preserves equals signs in inline flag values", () => {
    const args = parseArgs(["send", "waiting", "--message=a=b", "--descriptor=/tmp/a=b.json"]);

    expect(args.command).toBe("send");
    expect(args.positional).toEqual(["waiting"]);
    expect(args.flags.get("message")).toBe("a=b");
    expect(args.flags.get("descriptor")).toBe("/tmp/a=b.json");
  });
});

describe("debug CLI session", () => {
  it("stores and reads the latest single-send run id for smoke follow-ups", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-partner-debug-session-"));
    const path = join(dir, "debug-session.json");
    try {
      await writeDebugSessionRunId("run_debug_session", path);

      await expect(readDebugSessionRunId(path)).resolves.toBe("run_debug_session");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("ignores missing or malformed debug session state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-partner-debug-session-"));
    const path = join(dir, "debug-session.json");
    try {
      await expect(readDebugSessionRunId(path)).resolves.toBeUndefined();
      await writeFile(path, JSON.stringify({ runId: "bad" }));
      await expect(readDebugSessionRunId(path)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

describe("runtime descriptor discovery", () => {
  it("fails clearly when the descriptor is missing", async () => {
    await expectDebugCliError(
      readRuntimeDescriptor(join(tmpdir(), "ai-partner-missing-runtime-descriptor.json")),
      "descriptor_missing"
    );
  });

  it("rejects stale descriptor process and createdAt values", () => {
    const descriptor = runtimeDescriptor({ port: 43172 });

    expect(() =>
      validateRuntimeDescriptorFreshness(descriptor, { processAlive: () => false })
    ).toThrow(/process is not alive/);

    expect(() =>
      validateRuntimeDescriptorFreshness(descriptor, {
        now: new Date("2026-06-03T00:00:02Z"),
        processAlive: () => true,
        maxAgeMs: 1_000
      })
    ).toThrow(/stale by age/);

    expect(() =>
      validateRuntimeDescriptorFreshness(descriptor, {
        now: new Date("2026-06-05T00:00:00Z"),
        processAlive: () => true
      })
    ).not.toThrow();

    expect(() =>
      validateRuntimeDescriptorFreshness(
        {
          ...descriptor,
          createdAt: "2026-06-03T00:10:01Z"
        },
        {
          now: new Date("2026-06-03T00:00:00Z"),
          processAlive: () => true,
          futureSkewMs: 5 * 60 * 1_000
        }
      )
    ).toThrow(/in the future/);
  });

  it("rejects descriptor schema, pid, port, token, and createdAt violations", async () => {
    const cases: Array<Partial<RuntimeDescriptor>> = [
      {
        schemaVersion: "ai-partner.runtime-descriptor.v2" as RuntimeDescriptor["schemaVersion"]
      },
      { pid: 0 },
      { port: 0 },
      { token: "short" },
      { createdAt: "not-a-date" }
    ];

    for (const overrides of cases) {
      const dir = await mkdtemp(join(tmpdir(), "ai-partner-debug-cli-"));
      const path = join(dir, "runtime-descriptor.json");
      try {
        await writeFile(path, JSON.stringify(runtimeDescriptor(overrides), null, 2));
        await expectDebugCliError(readRuntimeDescriptor(path), "descriptor_stale");
      } finally {
        await rm(dir, { force: true, recursive: true });
      }
    }
  });

  it("fails freshness discovery when the descriptor endpoint is unreachable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-partner-debug-cli-"));
    const path = join(dir, "runtime-descriptor.json");

    try {
      await writeFile(
        path,
        JSON.stringify(runtimeDescriptor({ port: 43172, pid: process.pid }), null, 2)
      );

      await expectDebugCliError(
        discoverRuntime({
          descriptorPath: path,
          processAlive: () => true,
          connectTimeoutMs: 20,
          endpointReachable: async () => {
            throw new DebugCliError("unreachable", "endpoint_unreachable");
          }
        }),
        "endpoint_unreachable"
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

describe("workflow event sender", () => {
  it("sends legal bearer-authenticated events for every debug workflow state", async () => {
    const received: unknown[] = [];
    const descriptor = runtimeDescriptor({ port: 43172 });
    const runId = "run_debug_sender";

    for (const state of debugWorkflowStates) {
      const event = createWorkflowEvent({
        state,
        runId,
        timestamp: new Date("2026-06-03T00:00:00Z"),
        message: `debug ${state}`
      });
      await expect(
        sendWorkflowEvent(descriptor, event, {
          post: async (_descriptor, body, timeoutMs) => {
            const requestOptions = createWorkflowEventRequestOptions(
              _descriptor,
              body,
              timeoutMs
            );
            expect(requestOptions).toMatchObject({
              hostname: "127.0.0.1",
              port: descriptor.port,
              path: "/events",
              method: "POST"
            });
            expect(requestOptions.headers).toMatchObject({
              Authorization: `Bearer ${descriptor.token}`,
              "Content-Type": "application/json"
            });
            received.push(JSON.parse(body));
            return { status: 202, body: '{"ok":true}' };
          }
        })
      ).resolves.toMatchObject({ status: 202 });
    }

    expect(received).toHaveLength(debugWorkflowStates.length);
    expect(received.map((body) => (body as { workflow_state: string }).workflow_state)).toEqual(
      [...debugWorkflowStates]
    );
    for (const body of received) {
      expect(body).toMatchObject({
        schemaVersion: "ai-partner.workflow-event.v1",
        source: "cli",
        run_id: runId,
        code_context_allowed: false
      });
      expect(Object.keys(body as object).sort()).toEqual([
        "code_context_allowed",
        "event_id",
        "message",
        "run_id",
        "schemaVersion",
        "source",
        "timestamp",
        "workflow_state"
      ]);
      expect(() => assertNoForbiddenFields(body)).not.toThrow();
    }
  });

  it("reports bad token responses and connection failures", async () => {
    const descriptor = runtimeDescriptor({
      port: 43172,
      token: "wrong_runtime_token_123"
    });
    const event = createWorkflowEvent({
      state: "running",
      runId: "run_bad_token",
      timestamp: new Date("2026-06-03T00:00:00Z")
    });

    await expectDebugCliError(
      sendWorkflowEvent(descriptor, event, {
        post: async () => ({ status: 401, body: '{"ok":false,"error":"unauthorized"}' })
      }),
      "unauthorized"
    );
    await expectDebugCliError(
      sendWorkflowEvent(runtimeDescriptor({ port: 43172 }), event, {
        post: async () => {
          throw new DebugCliError("connection failed", "connection_failed");
        }
      }),
      "connection_failed"
    );
  });

  it("refuses forbidden code context fields before posting", async () => {
    const event = {
      ...createWorkflowEvent({ state: "editing", runId: "run_unsafe_payload" }),
      file: "/tmp/secret.txt"
    };

    await expectDebugCliError(
      sendWorkflowEvent(runtimeDescriptor({ port: 65_535 }), event, { timeoutMs: 20 }),
      "unsafe_payload"
    );
  });

  it("rebuilds the posted payload from the workflow event whitelist", async () => {
    const event = {
      ...createWorkflowEvent({
        state: "waiting",
        runId: "run_extra_payload",
        timestamp: new Date("2026-06-03T00:00:00Z")
      }),
      extra: "not sent"
    };
    let postedBody: unknown;

    await sendWorkflowEvent(runtimeDescriptor({ port: 43172 }), event, {
      post: async (_descriptor, body) => {
        postedBody = JSON.parse(body);
        return { status: 202, body: '{"ok":true}' };
      }
    });

    expect(postedBody).toEqual({
      schemaVersion: "ai-partner.workflow-event.v1",
      event_id: event.event_id,
      source: "cli",
      run_id: "run_extra_payload",
      workflow_state: "waiting",
      timestamp: "2026-06-03T00:00:00.000Z",
      code_context_allowed: false
    });
  });

  it("allows codex-wrapper events only when the caller opts into that source", async () => {
    const event = {
      ...createWorkflowEvent({
        state: "reading",
        runId: "run_codex_wrapper_sender",
        timestamp: new Date("2026-06-03T00:00:00Z")
      }),
      source: "codex-wrapper" as const
    };
    let postedBody: unknown;

    await expectDebugCliError(
      sendWorkflowEvent(runtimeDescriptor({ port: 43172 }), event, {
        post: async () => ({ status: 202, body: "{}" })
      }),
      "invalid_event"
    );

    await sendWorkflowEvent(runtimeDescriptor({ port: 43172 }), event, {
      allowedSources: ["codex-wrapper"],
      post: async (_descriptor, body) => {
        postedBody = JSON.parse(body);
        return { status: 202, body: "{}" };
      }
    });

    expect(postedBody).toEqual({
      schemaVersion: "ai-partner.workflow-event.v1",
      event_id: event.event_id,
      source: "codex-wrapper",
      run_id: "run_codex_wrapper_sender",
      workflow_state: "reading",
      timestamp: "2026-06-03T00:00:00.000Z",
      code_context_allowed: false
    });
  });

  it("keeps forbidden payload checks for codex-wrapper events", async () => {
    const event = {
      ...createWorkflowEvent({ state: "editing", runId: "run_codex_unsafe_payload" }),
      source: "codex-wrapper" as const,
      nested: {
        code: "secret source"
      }
    };

    await expectDebugCliError(
      sendWorkflowEvent(runtimeDescriptor({ port: 43172 }), event, {
        allowedSources: ["codex-wrapper"],
        post: async () => ({ status: 202, body: "{}" })
      }),
      "unsafe_payload"
    );
  });
});

function runtimeDescriptor(overrides: Partial<RuntimeDescriptor>): RuntimeDescriptor {
  return {
    schemaVersion: RUNTIME_DESCRIPTOR_SCHEMA_VERSION,
    appInstanceId: "app_debug_cli_test",
    pid: process.pid,
    port: 43172,
    token: "test_runtime_token_1234567890",
    createdAt: "2026-06-03T00:00:00Z",
    ...overrides
  };
}

async function expectDebugCliError(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DebugCliError);
    expect((error as DebugCliError).code).toBe(code);
    return;
  }

  throw new Error(`Expected DebugCliError ${code}`);
}
