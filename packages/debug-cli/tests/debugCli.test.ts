import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RuntimeDescriptor } from "@ai-partner/contracts";
import { describe, expect, it } from "vitest";
import {
  DebugCliError,
  RUNTIME_DESCRIPTOR_SCHEMA_VERSION,
  assertNoForbiddenFields,
  assertEndpointReachable,
  createCodexHookSignal,
  createWorkflowEventRequestOptions,
  debugWorkflowStates,
  discoverRuntime,
  normalizeCodexHookEventName,
  readRuntimeDescriptor,
  sendCodexHookEvent,
  sendWorkflowEvent,
  createWorkflowEvent,
  readDebugSessionRunId,
  quitPartnerRuntime,
  writeDebugSessionRunId,
  togglePartner,
  validateRuntimeDescriptorFreshness
} from "../src";
import { discoverOptions, parseArgs } from "../src/cli";

describe("CLI args", () => {
  it("preserves equals signs in inline flag values", () => {
    const args = parseArgs(["send", "waiting", "--message=a=b", "--descriptor=/tmp/a=b.json"]);

    expect(args.command).toBe("send");
    expect(args.positional).toEqual(["waiting"]);
    expect(args.flags.get("message")).toBe("a=b");
    expect(args.flags.get("descriptor")).toBe("/tmp/a=b.json");
  });

  it("can skip redundant endpoint probes for send-style commands", () => {
    const args = parseArgs(["send", "waiting", "--descriptor", "/tmp/runtime.json"]);

    expect(discoverOptions(args)).toMatchObject({
      descriptorPath: "/tmp/runtime.json",
      skipEndpointCheck: undefined
    });
    expect(discoverOptions(args, { skipEndpointCheck: true })).toMatchObject({
      descriptorPath: "/tmp/runtime.json",
      skipEndpointCheck: true
    });
  });

  it("parses resolved authorization flags for manual smoke checks", () => {
    const args = parseArgs([
      "send",
      "waiting",
      "--auth-id",
      "auth_debug_status",
      "--auth-description",
      "git status",
      "--auth-status",
      "allowed",
      "--auth-decided-at",
      "2026-06-03T00:00:00Z"
    ]);

    expect(args.flags.get("auth-status")).toBe("allowed");
    expect(args.flags.get("auth-decided-at")).toBe("2026-06-03T00:00:00Z");
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

describe("partner toggle", () => {
  it("forwards root pnpm partner arguments only to the debug partner command", async () => {
    const { runPartnerScript } = await import(
      pathToFileURL(resolve(repoRoot, "scripts/partner.mjs")).href
    );
    const calls: Array<{ command: string; args: string[] }> = [];

    await runPartnerScript(
      [
        "--",
        "--app-path",
        "/tmp/Test Partner.app",
        "--descriptor",
        "/tmp/runtime-descriptor.json"
      ],
      async (command: string, args: string[]) => {
        calls.push({ command, args });
      }
    );

    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      command: "pnpm",
      args: ["--filter", "@ai-partner/debug-cli", "build"]
    });
    expect(calls[1]?.args).toEqual([
      resolve(repoRoot, "packages/debug-cli/dist/cli.js"),
      "partner",
      "--app-path",
      "/tmp/Test Partner.app",
      "--descriptor",
      "/tmp/runtime-descriptor.json"
    ]);
    expect(calls[2]?.args).toEqual([
      resolve(repoRoot, "scripts/install-codex-hooks.mjs"),
      "--warn"
    ]);
  });

  it("stops a running partner runtime through the authorized local control endpoint", async () => {
    const descriptor = runtimeDescriptor({ port: 43172 });
    const quitCalls: RuntimeDescriptor[] = [];

    await expect(
      togglePartner({
        descriptorPath: "/tmp/runtime-descriptor.json",
        discover: async () => descriptor,
        quit: async (runtime) => {
          quitCalls.push(runtime);
        },
        launch: async () => {
          throw new Error("launch should not run when descriptor is fresh");
        }
      })
    ).resolves.toEqual({
      action: "stopped",
      descriptorPath: "/tmp/runtime-descriptor.json"
    });
    expect(quitCalls).toEqual([descriptor]);
  });

  it("starts the packaged app when no live descriptor is available", async () => {
    const launched: string[] = [];

    await expect(
      togglePartner({
        appPath: "/Applications/AI Partner.app",
        descriptorPath: "/tmp/missing-runtime-descriptor.json",
        discover: async () => {
          throw new DebugCliError("missing", "descriptor_missing");
        },
        launch: async (appPath) => {
          launched.push(appPath);
        }
      })
    ).resolves.toEqual({
      action: "started",
      appPath: "/Applications/AI Partner.app",
      descriptorPath: "/tmp/missing-runtime-descriptor.json"
    });
    expect(launched).toEqual(["/Applications/AI Partner.app"]);
  });

  it("uses the explicit descriptor for stop without resolving the default app path", async () => {
    const descriptor = runtimeDescriptor({ port: 43172 });
    const quitCalls: RuntimeDescriptor[] = [];

    await expect(
      togglePartner({
        appPath: "/missing/should-not-be-opened.app",
        descriptorPath: "/tmp/explicit-runtime-descriptor.json",
        discover: async (options) => {
          expect(options.descriptorPath).toBe("/tmp/explicit-runtime-descriptor.json");
          return descriptor;
        },
        quit: async (runtime) => {
          quitCalls.push(runtime);
        },
        launch: async () => {
          throw new Error("launch should not run for a live descriptor");
        }
      })
    ).resolves.toEqual({
      action: "stopped",
      descriptorPath: "/tmp/explicit-runtime-descriptor.json"
    });
    expect(quitCalls).toEqual([descriptor]);
  });

  it("creates a quit control request to the control endpoint with no body", async () => {
    const descriptor = runtimeDescriptor({ port: 43172 });
    const requests: Array<{ descriptor: RuntimeDescriptor; timeoutMs: number }> = [];

    await quitPartnerRuntime(descriptor, {
      post: async (runtime, timeoutMs) => {
        requests.push({ descriptor: runtime, timeoutMs });
        return { status: 202, body: '{"ok":true,"action":"quit"}' };
      }
    });

    expect(requests).toEqual([
      {
        descriptor,
        timeoutMs: expect.any(Number)
      }
    ]);
  });

  it("does not start a new app when the existing runtime rejects quit auth", async () => {
    await expectDebugCliError(
      togglePartner({
        discover: async () => runtimeDescriptor({ port: 43172 }),
        quit: async () => {
          throw new DebugCliError("bad token", "unauthorized");
        },
        launch: async () => {
          throw new Error("launch should not run after auth failure");
        }
      }),
      "unauthorized"
    );
  });

  it("posts quit control without a JSON body", async () => {
    let posted: { status: number; body: string } | undefined;

    await quitPartnerRuntime(runtimeDescriptor({ port: 43172 }), {
      post: async (_descriptor, timeoutMs) => {
        expect(timeoutMs).toBeGreaterThan(0);
        posted = { status: 202, body: '{"ok":true,"action":"quit"}' };
        return posted;
      }
    });

    expect(posted).toEqual({ status: 202, body: '{"ok":true,"action":"quit"}' });
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

  it("includes unexpected endpoint response bodies in reachability errors", async () => {
    await expect(
      assertEndpointReachable(43172, 20, async () => ({
        status: 400,
        body: '{"ok":false,"error":"invalid_content_length"}'
      }))
    ).rejects.toMatchObject({
      code: "endpoint_unreachable",
      message: expect.stringContaining("invalid_content_length")
    });
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

  it("can create a pending authorization event for card UI smoke checks", () => {
    const event = createWorkflowEvent({
      state: "waiting",
      runId: "run_auth_debug",
      timestamp: new Date("2026-06-03T00:00:00Z"),
      message: "needs approval",
      contextPath: "/Users/aloha66/code/ai-partner",
      source: "claude-hook",
      authorization: {
        kind: "command",
        id: "auth_debug_status",
        title: "Command approval preview",
        description: "git status",
        status: "pending"
      }
    });

    expect(event).toMatchObject({
      source: "claude-hook",
      workflow_state: "waiting",
      context_path: "/Users/aloha66/code/ai-partner",
      authorization: {
        kind: "command",
        id: "auth_debug_status",
        title: "Command approval preview",
        description: "git status",
        status: "pending"
      },
      code_context_allowed: false
    });
    expect(() => assertNoForbiddenFields(event)).not.toThrow();
  });

  it("can send resolved authorization events for command-line decision smoke checks", async () => {
    const event = createWorkflowEvent({
      state: "waiting",
      runId: "run_auth_debug",
      timestamp: new Date("2026-06-03T00:00:00Z"),
      authorization: {
        kind: "command",
        id: "auth_debug_status",
        description: "git status",
        status: "allowed",
        decidedAt: "2026-06-03T00:00:00Z"
      }
    });
    let postedBody: unknown;

    await sendWorkflowEvent(runtimeDescriptor({ port: 43172 }), event, {
      post: async (_descriptor, body) => {
        postedBody = JSON.parse(body);
        return { status: 202, body: '{"ok":true}' };
      }
    });

    expect(postedBody).toMatchObject({
      workflow_state: "waiting",
      authorization: {
        id: "auth_debug_status",
        status: "allowed",
        decidedAt: "2026-06-03T00:00:00Z"
      }
    });
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

  it("validates authorization fields when posting a caller-provided event", async () => {
    const event = {
      ...createWorkflowEvent({
        state: "waiting",
        runId: "run_auth_direct_post",
        timestamp: new Date("2026-06-03T00:00:00Z")
      }),
      authorization: {
        kind: "command",
        id: "auth_direct_post",
        description: "git status\ncat secret",
        status: "pending"
      }
    };

    await expectDebugCliError(
      sendWorkflowEvent(runtimeDescriptor({ port: 43172 }), event, {
        post: async () => ({ status: 202, body: "{}" })
      }),
      "invalid_message"
    );
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

describe("Codex hook sender", () => {
  it("normalizes Codex hook event names from current and legacy shapes", () => {
    expect(normalizeCodexHookEventName("PreToolUse")).toBe("PreToolUse");
    expect(normalizeCodexHookEventName("pre_tool_use")).toBe("PreToolUse");
    expect(normalizeCodexHookEventName("permission-request")).toBe("PermissionRequest");
    expect(normalizeCodexHookEventName("missing")).toBeUndefined();
  });

  it("maps hook payload metadata to safe workflow events", async () => {
    const descriptor = runtimeDescriptor({ port: 43172 });
    let postedBody: unknown;

    await expect(
      sendCodexHookEvent({
        input: {
          hook_event_name: "pre_tool_use",
          tool_name: "apply_patch",
          turn_id: "turn:123"
        },
        cwd: "/Users/aloha66/code/ai-partner",
        timestamp: new Date("2026-06-03T00:00:00Z"),
        discover: async () => descriptor,
        send: async (_descriptor, event, options) => {
          expect(options.allowedSources).toEqual(["codex-hook"]);
          expect(_descriptor).toBe(descriptor);
          postedBody = event;
          return { status: 202, body: "{}" };
        }
      })
    ).resolves.toMatchObject({
      source: "codex-hook",
      workflow_state: "editing",
      run_id: "run_codex_hook_turn:123",
      message: "Codex is editing",
      context_path: "/Users/aloha66/code/ai-partner",
      code_context_allowed: false
    });

    expect(postedBody).toMatchObject({
      source: "codex-hook",
      workflow_state: "editing",
      context_path: "/Users/aloha66/code/ai-partner",
      code_context_allowed: false
    });
    expect(() => assertNoForbiddenFields(postedBody)).not.toThrow();
  });

  it("reports approval waits and completed turns without code context", () => {
    expect(
      createCodexHookSignal({
        hookEventName: "PermissionRequest",
        session_id: "session/with spaces"
      })
    ).toMatchObject({
      eventName: "PermissionRequest",
      state: "waiting",
      runId: "run_codex_hook_session_with_spaces",
      message: "Codex is waiting for approval"
    });

    expect(createCodexHookSignal({ hook_event_name: "stop", turn_id: "turn_1" }))
      .toMatchObject({
        eventName: "Stop",
        state: "done",
        runId: "run_codex_hook_turn_1",
        message: "Codex turn completed"
      });
  });

  it("reuses the active turn run_id for Stop hooks that only include a session id", async () => {
    const descriptor = runtimeDescriptor({ port: 43172 });
    const sentEvents: Array<{ run_id: string; workflow_state: string }> = [];
    const cacheDir = await mkdtemp(join(tmpdir(), "ai-partner-hook-test-"));
    const send = async (
      _descriptor: RuntimeDescriptor,
      event: { run_id: string; workflow_state: string }
    ) => {
      sentEvents.push({
        run_id: event.run_id,
        workflow_state: event.workflow_state
      });
      return { status: 202, body: "{}" };
    };

    await sendCodexHookEvent({
      input: {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        turn_id: "turn_abc",
        session_id: "session_abc"
      },
      cwd: "/Users/aloha66/code/ai-partner",
      cacheDir,
      discover: async () => descriptor,
      send
    });
    await sendCodexHookEvent({
      input: {
        hook_event_name: "Stop",
        session_id: "session_abc"
      },
      cwd: "/Users/aloha66/code/ai-partner",
      cacheDir,
      discover: async () => descriptor,
      send
    });

    expect(sentEvents).toEqual([
      {
        run_id: "run_codex_hook_turn_abc",
        workflow_state: "reading"
      },
      {
        run_id: "run_codex_hook_turn_abc",
        workflow_state: "done"
      }
    ]);
  });

  it("reuses the latest workspace run_id for Stop hooks that omit session metadata", async () => {
    const descriptor = runtimeDescriptor({ port: 43172 });
    const sentEvents: Array<{ run_id: string; workflow_state: string }> = [];
    const cacheDir = await mkdtemp(join(tmpdir(), "ai-partner-hook-test-"));
    const send = async (
      _descriptor: RuntimeDescriptor,
      event: { run_id: string; workflow_state: string }
    ) => {
      sentEvents.push({
        run_id: event.run_id,
        workflow_state: event.workflow_state
      });
      return { status: 202, body: "{}" };
    };

    try {
      await sendCodexHookEvent({
        input: {
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          turn_id: "turn_workspace",
          session_id: "session_workspace"
        },
        cwd: "/Users/aloha66/code/ai-partner",
        cacheDir,
        discover: async () => descriptor,
        send
      });
      await sendCodexHookEvent({
        input: {
          hook_event_name: "Stop"
        },
        cwd: "/Users/aloha66/code/ai-partner",
        cacheDir,
        discover: async () => descriptor,
        send
      });

      expect(sentEvents).toEqual([
        {
          run_id: "run_codex_hook_turn_workspace",
          workflow_state: "reading"
        },
        {
          run_id: "run_codex_hook_turn_workspace",
          workflow_state: "done"
        }
      ]);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("reuses the session run_id when Stop hook cwd metadata is missing or different", async () => {
    const descriptor = runtimeDescriptor({ port: 43172 });
    const sentEvents: Array<{ run_id: string; workflow_state: string }> = [];
    const cacheDir = await mkdtemp(join(tmpdir(), "ai-partner-hook-test-"));
    const send = async (
      _descriptor: RuntimeDescriptor,
      event: { run_id: string; workflow_state: string }
    ) => {
      sentEvents.push({
        run_id: event.run_id,
        workflow_state: event.workflow_state
      });
      return { status: 202, body: "{}" };
    };

    try {
      await sendCodexHookEvent({
        input: {
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          turn_id: "turn_session_fallback",
          session_id: "session_fallback",
          cwd: "/Users/aloha66/.codex/worktrees/58a6/ai-partner"
        },
        cwd: "/Users/aloha66/code/ai-partner",
        cacheDir,
        discover: async () => descriptor,
        send
      });
      await sendCodexHookEvent({
        input: {
          hook_event_name: "Stop",
          session_id: "session_fallback"
        },
        cwd: "/Users/aloha66/code/ai-partner",
        cacheDir,
        discover: async () => descriptor,
        send
      });

      expect(sentEvents).toEqual([
        {
          run_id: "run_codex_hook_turn_session_fallback",
          workflow_state: "reading"
        },
        {
          run_id: "run_codex_hook_turn_session_fallback",
          workflow_state: "done"
        }
      ]);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("uses Codex hook cwd metadata before falling back to the sender cwd", () => {
    expect(
      createCodexHookSignal(
        {
          hookEventName: "UserPromptSubmit",
          cwd: "/Users/aloha66/.codex/worktrees/58a6/ai-partner",
          session_id: "session_1"
        },
        { cwd: "/Users/aloha66/code/ai-partner" }
      )
    ).toMatchObject({
      contextPath: "/Users/aloha66/.codex/worktrees/58a6/ai-partner"
    });

    expect(
      createCodexHookSignal(
        {
          hookEventName: "UserPromptSubmit",
          session_id: "session_1"
        },
        { cwd: "/Users/aloha66/code/ai-partner" }
      )
    ).toMatchObject({
      contextPath: "/Users/aloha66/code/ai-partner"
    });
  });

  it("stays best-effort by default when the partner runtime is unavailable", async () => {
    await expect(
      sendCodexHookEvent({
        eventName: "UserPromptSubmit",
        input: { session_id: "missing-runtime" },
        discover: async () => {
          throw new DebugCliError("missing", "descriptor_missing");
        }
      })
    ).resolves.toBeUndefined();
  });

  it("can be strict for installer and smoke-test diagnostics", async () => {
    await expectDebugCliError(
      sendCodexHookEvent({
        eventName: "UserPromptSubmit",
        input: { session_id: "missing-runtime" },
        strict: true,
        discover: async () => {
          throw new DebugCliError("missing", "descriptor_missing");
        }
      }),
      "descriptor_missing"
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

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
