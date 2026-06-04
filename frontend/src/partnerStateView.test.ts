import {
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  type PartnerStateSnapshot
} from "@ai-partner/contracts";
import { describe, expect, it } from "vitest";
import {
  idlePartnerState,
  partnerStateDisplay
} from "./partnerStateView";

describe("partner state display", () => {
  it("renders a startup idle snapshot fallback", () => {
    expect(partnerStateDisplay(null)).toEqual({
      workflowLabel: "idle",
      message: "等待 workflow 事件",
      sourceLabel: "none",
      pausedLabel: "live",
      connectionLabel: "disconnected",
      runLabel: "no active run",
      canPause: true,
      canResume: false,
      canClearError: false
    });
    expect(idlePartnerState.workflowState).toBe("idle");
  });

  it("renders workflow state, source, message, pause, and connection fields", () => {
    const snapshot: PartnerStateSnapshot = {
      schemaVersion: PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
      workflowState: "editing",
      runId: "run_debug_1",
      activeRunId: "run_debug_1",
      source: "cli",
      message: "debug sender event",
      priority: "normal",
      updatedAt: "2026-06-04T00:00:00Z",
      paused: true,
      connection: "ok"
    };

    expect(partnerStateDisplay(snapshot)).toEqual({
      workflowLabel: "editing",
      message: "debug sender event",
      sourceLabel: "debug cli",
      pausedLabel: "paused",
      connectionLabel: "ok",
      runLabel: "run_debug_1",
      canPause: false,
      canResume: true,
      canClearError: false
    });
  });

  it("enables clear error only for error snapshots", () => {
    expect(
      partnerStateDisplay({
        ...idlePartnerState,
        workflowState: "error",
        source: "codex-wrapper",
        connection: "degraded"
      })
    ).toMatchObject({
      workflowLabel: "error",
      message: "工作流出错",
      sourceLabel: "codex",
      connectionLabel: "degraded",
      canClearError: true
    });
  });

});
