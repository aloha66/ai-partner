import {
  type WorkflowAuthorization,
  type WorkflowSource,
  type WorkflowState
} from "./workflow";
import { PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION } from "./versions";

export const snapshotPriorities = ["normal", "high"] as const;
export const connectionStates = ["ok", "degraded", "disconnected"] as const;

export type SnapshotPriority = (typeof snapshotPriorities)[number];
export type ConnectionState = (typeof connectionStates)[number];

// v1 is intentionally a single active workflow snapshot. Multiple agent/worktree
// events are resolved by the state store before this contract reaches the UI.
export interface PartnerStateSnapshot {
  schemaVersion: typeof PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION;
  workflowState: WorkflowState;
  runId: string | null;
  activeRunId: string | null;
  source: WorkflowSource | null;
  message?: string;
  cardTitle?: string;
  contextPath?: string;
  authorization?: WorkflowAuthorization;
  priority: SnapshotPriority;
  updatedAt: string;
  paused: boolean;
  connection: ConnectionState;
}
