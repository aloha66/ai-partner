import { describe, expect, it } from "vitest";
import { classifyCodexExit, classifyCodexLine } from "../src";

describe("Codex wrapper classifier", () => {
  it("prefers structured workflow_state over text fallback", () => {
    expect(
      classifyCodexLine('{"workflow_state":"editing","message":"reading docs first"}')
    ).toMatchObject({
      state: "editing",
      kind: "structured",
      confidence: "high"
    });
  });

  it("maps structured event names conservatively", () => {
    expect(classifyCodexLine('{"type":"exec_command_begin"}')).toMatchObject({
      state: "running",
      kind: "structured"
    });
    expect(classifyCodexLine('{"event":"apply_patch"}')).toMatchObject({
      state: "editing",
      kind: "structured"
    });
    expect(classifyCodexLine('{"event":"approval_requested"}')).toMatchObject({
      state: "waiting",
      kind: "structured"
    });
  });

  it("uses stdout/stderr fallback for broad status words only", () => {
    expect(classifyCodexLine("searching project files")).toMatchObject({
      state: "reading",
      kind: "fallback"
    });
    expect(classifyCodexLine("patch applied successfully")).toMatchObject({
      state: "editing",
      kind: "fallback"
    });
    expect(classifyCodexLine("requires approval before running")).toMatchObject({
      state: "waiting",
      kind: "fallback"
    });
  });

  it("falls back to running when uncertain", () => {
    expect(classifyCodexLine("here is some arbitrary model text")).toMatchObject({
      state: "running",
      matcher: "text.unknown"
    });
    expect(classifyCodexLine('{"type":"unknown_future_event"}')).toMatchObject({
      state: "running",
      matcher: "structured.unknown"
    });
  });

  it("classifies process exit as done or error", () => {
    expect(classifyCodexExit(0, null)).toMatchObject({ state: "done" });
    expect(classifyCodexExit(1, null)).toMatchObject({ state: "error" });
    expect(classifyCodexExit(null, "SIGTERM")).toMatchObject({ state: "error" });
  });
});
