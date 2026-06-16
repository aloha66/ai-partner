import {
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  type PartnerStateSnapshot
} from "@ai-partner/contracts";
import { describe, expect, it } from "vitest";
import {
  idlePartnerState,
  interactiveCardView,
  resolveAuthorizationDecision,
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

  it("renders a running status card with context and source details", () => {
    expect(
      interactiveCardView({
        ...idlePartnerState,
        workflowState: "running",
        runId: "run_debug_1",
        activeRunId: "run_debug_1",
        source: "codex-wrapper",
        message: "正在执行 pnpm test",
        contextPath: "/Users/aloha66/code/ai-partner",
        cardTitle: "Running command"
      })
    ).toEqual({
      visible: true,
      variant: "status",
      tone: "active",
      title: "Running command",
      statusText: "正在执行 pnpm test",
      contextPath: "/Users/aloha66/code/ai-partner",
      sourceLabel: "Codex",
      action: null
    });
  });

  it("renders a pending authorization card and resolves local button decisions", () => {
    const snapshot: PartnerStateSnapshot = {
      ...idlePartnerState,
      workflowState: "waiting",
      runId: "run_auth_1",
      activeRunId: "run_auth_1",
      source: "claude-hook",
      message: "需要授权执行 git status",
      contextPath: "/Users/aloha66/code/ai-partner",
      authorization: {
        kind: "command",
        id: "auth_git_status",
        title: "Allow command?",
        description: "git status",
        status: "pending"
      }
    };
    const authorization = snapshot.authorization;
    expect(authorization).toBeDefined();

    expect(interactiveCardView(snapshot)).toMatchObject({
      visible: true,
      variant: "authorization",
      tone: "attention",
      title: "Allow command?",
      statusText: "git status",
      contextPath: "/Users/aloha66/code/ai-partner",
      sourceLabel: "Claude Hook",
      action: {
        id: "auth_git_status",
        kind: "command",
        status: "pending",
        allowLabel: "Allow",
        denyLabel: "Deny"
      }
    });

    expect(resolveAuthorizationDecision(authorization!, "allow")).toMatchObject({
      id: "auth_git_status",
      status: "allowed",
      decidedAt: expect.stringMatching(/^20/)
    });
    expect(resolveAuthorizationDecision(authorization!, "deny")).toMatchObject({
      id: "auth_git_status",
      status: "denied",
      decidedAt: expect.stringMatching(/^20/)
    });
  });

});
