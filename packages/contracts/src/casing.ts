import {
  WORKFLOW_EVENT_SCHEMA_VERSION,
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION
} from "./versions";
import type { PartnerStateSnapshot } from "./snapshot";
import type { WorkflowEvent, WorkflowEventWire } from "./workflow";

export function workflowEventFromWire(event: WorkflowEventWire): WorkflowEvent {
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.event_id,
    source: event.source,
    runId: event.run_id,
    workflowState: event.workflow_state,
    timestamp: event.timestamp,
    ...(event.message === undefined ? {} : { message: event.message }),
    codeContextAllowed: event.code_context_allowed
  };
}

export function workflowEventToWire(event: WorkflowEvent): WorkflowEventWire {
  return {
    schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
    event_id: event.eventId,
    source: event.source,
    run_id: event.runId,
    workflow_state: event.workflowState,
    timestamp: event.timestamp,
    ...(event.message === undefined ? {} : { message: event.message }),
    code_context_allowed: false
  };
}

export function snapshotFromWorkflowEvent(
  event: WorkflowEvent,
  updatedAt = event.timestamp
): PartnerStateSnapshot {
  return {
    schemaVersion: PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
    workflowState: event.workflowState,
    runId: event.runId,
    activeRunId: event.runId,
    source: event.source,
    ...(event.message === undefined ? {} : { message: event.message }),
    priority: event.workflowState === "waiting" || event.workflowState === "error" ? "high" : "normal",
    updatedAt,
    paused: false,
    connection: "ok"
  };
}
