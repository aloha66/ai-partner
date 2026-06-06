import {
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  type PartnerStateSnapshot
} from "@ai-partner/contracts";
import { describe, expect, it } from "vitest";
import { resolvePartnerIntent } from "./animationIntentView";

function snapshot(
  workflowState: PartnerStateSnapshot["workflowState"],
  message?: string
): PartnerStateSnapshot {
  return {
    schemaVersion: PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
    workflowState,
    runId: "run_frontend",
    activeRunId: "run_frontend",
    source: "cli",
    message,
    priority: "normal",
    updatedAt: "2026-06-05T00:00:00Z",
    paused: false,
    connection: "ok"
  };
}

describe("animation intent view", () => {
  it("resolves workflow snapshots with default Petdex capabilities", () => {
    const reading = resolvePartnerIntent(snapshot("reading"), "normal");
    const waitingCarried = resolvePartnerIntent(snapshot("waiting", "等待确认"), "carried");

    expect(reading.body.animation).toBe("legacy.review");
    expect(waitingCarried.body.animation).toBe("legacy.idle");
    expect(waitingCarried.bubble).toEqual({
      state: "waiting",
      text: "等待确认",
      priority: "high"
    });
  });
});
