import {
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  type PartnerStateSnapshot,
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
  "demo-script": "demo"
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
