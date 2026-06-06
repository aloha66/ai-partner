import { describe, expect, it } from "vitest";
import { assertNoForbiddenFields, workflowEventPayloadForPost } from "@ai-partner/debug-cli";
import { createCodexWorkflowEvent } from "../src";

describe("Codex wrapper workflow events", () => {
  it("creates codex-wrapper events with only safe status metadata", () => {
    const event = createCodexWorkflowEvent({
      state: "reading",
      runId: "run_codex_event_test",
      eventId: "evt_codex_event_test",
      timestamp: new Date("2026-06-03T00:00:00Z")
    });
    const payload = workflowEventPayloadForPost(event, {
      allowedSources: ["codex-wrapper"]
    });

    expect(payload).toEqual({
      schemaVersion: "ai-partner.workflow-event.v1",
      event_id: "evt_codex_event_test",
      source: "codex-wrapper",
      run_id: "run_codex_event_test",
      workflow_state: "reading",
      timestamp: "2026-06-03T00:00:00.000Z",
      message: "Codex is reading",
      code_context_allowed: false
    });
    expect(() => assertNoForbiddenFields(payload)).not.toThrow();
  });
});
