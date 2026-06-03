import { type WorkflowSource, type WorkflowState } from "./workflow";
import { PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION } from "./versions";

export const snapshotPriorities = ["normal", "high"] as const;
export const connectionStates = ["ok", "degraded", "disconnected"] as const;

export type SnapshotPriority = (typeof snapshotPriorities)[number];
export type ConnectionState = (typeof connectionStates)[number];

export interface PartnerStateSnapshot {
  schemaVersion: typeof PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION;
  workflowState: WorkflowState;
  runId: string | null;
  activeRunId: string | null;
  source: WorkflowSource | null;
  message?: string;
  priority: SnapshotPriority;
  updatedAt: string;
  paused: boolean;
  connection: ConnectionState;
}
