import type { WorkflowState } from "@ai-partner/contracts";

export const RUNTIME_DESCRIPTOR_SCHEMA_VERSION =
  "ai-partner.runtime-descriptor.v1" as const;
export const WORKFLOW_EVENT_SCHEMA_VERSION = "ai-partner.workflow-event.v1" as const;

export const descriptorDirName = "ai-partner";
export const descriptorFileName = "runtime-descriptor.json";
export const defaultConnectTimeoutMs = 500;
export const defaultPostTimeoutMs = 2_000;
export const descriptorFutureSkewMs = 5 * 60 * 1_000;
export const descriptorMaxAgeMs: number | undefined = undefined;

export const debugWorkflowStates = [
  "running",
  "reading",
  "editing",
  "waiting",
  "error",
  "done"
] as const satisfies readonly WorkflowState[];

export type DebugWorkflowState = (typeof debugWorkflowStates)[number];

export const forbiddenWorkflowPayloadFields = [
  "clipboard",
  "code",
  "diff",
  "file",
  "file-content",
  "fileContent",
  "file_content",
  "prompt",
  "screen-text",
  "screenText",
  "screen_text"
] as const;
