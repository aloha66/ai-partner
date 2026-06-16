import {
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  type PartnerStateSnapshot,
  type WorkflowAuthorization,
  type WorkflowSource,
  type WorkflowState
} from "@ai-partner/contracts";

export const idlePartnerState: PartnerStateSnapshot = {
  schemaVersion: PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  workflowState: "idle",
  runId: null,
  activeRunId: null,
  source: null,
  priority: "normal",
  updatedAt: "1970-01-01T00:00:00Z",
  paused: false,
  connection: "disconnected"
};

const workflowLabels: Record<WorkflowState, string> = {
  idle: "idle",
  running: "running",
  reading: "reading",
  editing: "editing",
  waiting: "waiting",
  error: "error",
  done: "done"
};

const defaultMessages: Record<WorkflowState, string> = {
  idle: "等待 workflow 事件",
  running: "AI 正在运行",
  reading: "正在读取项目内容",
  editing: "正在编辑",
  waiting: "等待用户输入",
  error: "工作流出错",
  done: "工作流完成"
};

const sourceLabels: Record<WorkflowSource, string> = {
  cli: "debug cli",
  "codex-wrapper": "codex",
  "demo-script": "demo",
  "claude-hook": "hook event"
};

const cardSourceLabels: Record<WorkflowSource, string> = {
  cli: "Debug CLI",
  "codex-wrapper": "Codex",
  "demo-script": "Demo",
  "claude-hook": "Hook event"
};

export interface PartnerStateDisplay {
  workflowLabel: string;
  message: string;
  sourceLabel: string;
  pausedLabel: string;
  connectionLabel: string;
  runLabel: string;
  canPause: boolean;
  canResume: boolean;
  canClearError: boolean;
}

export interface InteractiveCardAction {
  id: string;
  kind: WorkflowAuthorization["kind"];
  status: WorkflowAuthorization["status"];
  allowLabel: string;
  denyLabel: string;
}

export interface InteractiveCardView {
  visible: boolean;
  variant: "status" | "authorization";
  tone: "idle" | "active" | "attention" | "success" | "danger";
  title: string;
  statusText: string;
  contextPath: string | null;
  sourceLabel: string;
  action: InteractiveCardAction | null;
}

type AuthorizationChoice = "allow" | "deny";

export function partnerStateDisplay(snapshot: PartnerStateSnapshot | null): PartnerStateDisplay {
  const state = snapshot ?? idlePartnerState;
  return {
    workflowLabel: workflowLabels[state.workflowState],
    message: state.message ?? defaultMessages[state.workflowState],
    sourceLabel: state.source === null ? "none" : sourceLabels[state.source],
    pausedLabel: state.paused ? "paused" : "live",
    connectionLabel: state.connection,
    runLabel: state.activeRunId ?? state.runId ?? "no active run",
    canPause: !state.paused,
    canResume: state.paused,
    canClearError: state.workflowState === "error"
  };
}

export function interactiveCardView(snapshot: PartnerStateSnapshot | null): InteractiveCardView {
  const state = snapshot ?? idlePartnerState;
  const authorization = state.authorization;

  if (authorization) {
    const title = authorization.title ?? state.cardTitle ?? "Authorization required";
    return {
      visible: true,
      variant: "authorization",
      tone: authorizationTone(authorization.status),
      title,
      statusText: authorization.description,
      contextPath: state.contextPath ?? null,
      sourceLabel: state.source === null ? "Unknown" : cardSourceLabels[state.source],
      action: {
        id: authorization.id,
        kind: authorization.kind,
        status: authorization.status,
        allowLabel: "Preview allow",
        denyLabel: "Preview deny"
      }
    };
  }

  if (state.workflowState === "idle") {
    return {
      visible: false,
      variant: "status",
      tone: "idle",
      title: "Idle",
      statusText: defaultMessages.idle,
      contextPath: null,
      sourceLabel: "None",
      action: null
    };
  }

  return {
    visible: true,
    variant: "status",
    tone: statusTone(state.workflowState),
    title: state.cardTitle ?? statusTitle(state.workflowState),
    statusText: state.message ?? defaultMessages[state.workflowState],
    contextPath: state.contextPath ?? null,
    sourceLabel: state.source === null ? "Unknown" : cardSourceLabels[state.source],
    action: null
  };
}

export function resolveAuthorizationDecision(
  authorization: WorkflowAuthorization,
  choice: AuthorizationChoice,
  now = new Date()
): WorkflowAuthorization {
  if (authorization.status !== "pending") {
    return authorization;
  }
  return {
    ...authorization,
    status: choice === "allow" ? "allowed" : "denied",
    decidedAt: now.toISOString()
  };
}

export function localAuthorizationDecisionKey(snapshot: PartnerStateSnapshot): string {
  const authorization = snapshot.authorization;
  if (!authorization) {
    return "none";
  }
  return [
    snapshot.activeRunId ?? snapshot.runId ?? "no-run",
    snapshot.updatedAt,
    authorization.id
  ].join(":");
}

function statusTitle(state: WorkflowState): string {
  switch (state) {
    case "running":
      return "Running";
    case "reading":
      return "Reading";
    case "editing":
      return "Editing";
    case "waiting":
      return "Waiting";
    case "error":
      return "Error";
    case "done":
      return "Done";
    case "idle":
      return "Idle";
  }
}

function statusTone(state: WorkflowState): InteractiveCardView["tone"] {
  switch (state) {
    case "waiting":
      return "attention";
    case "error":
      return "danger";
    case "done":
      return "success";
    case "idle":
      return "idle";
    case "running":
    case "reading":
    case "editing":
      return "active";
  }
}

function authorizationTone(status: WorkflowAuthorization["status"]): InteractiveCardView["tone"] {
  switch (status) {
    case "pending":
      return "attention";
    case "allowed":
      return "success";
    case "denied":
      return "danger";
  }
}
