import {
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  type PartnerStateSnapshot
} from "@ai-partner/contracts";
import { type PartnerCapabilities } from "@ai-partner/resolver";
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

  it("accepts loaded capabilities and resolver queue state from the frontend boundary", () => {
    const capabilities: PartnerCapabilities = {
      partnerId: "loaded-partner",
      animations: {
        "workflow.done": {
          animation: "workflow.done",
          loop: false
        },
        "physical.falling": {
          animation: "physical.falling",
          loop: false,
          procedural: ["drop"]
        },
        "legacy.idle": {
          animation: "legacy.idle",
          loop: true
        }
      },
      fallbacks: {},
      runtimeLimits: {
        frameWidth: 192,
        frameHeight: 208,
        maxFramesPerAnimation: 32,
        minFps: 1,
        maxFps: 24
      }
    };
    const doneWhileFalling = resolvePartnerIntent(snapshot("done"), "falling", {
      now: new Date("2026-06-05T00:00:00Z"),
      capabilities
    });
    const replayed = resolvePartnerIntent(snapshot("idle"), "normal", {
      now: new Date("2026-06-05T00:00:04Z"),
      capabilities,
      queued: doneWhileFalling.queued
    });

    expect(doneWhileFalling.body.animation).toBe("physical.falling");
    expect(doneWhileFalling.queued).toEqual([
      {
        animation: "workflow.done",
        reason: "physical-override",
        expiresAt: "2026-06-05T00:00:05.000Z"
      }
    ]);
    expect(replayed.body.animation).toBe("workflow.done");
    expect(replayed.body.loop).toBe(false);
    expect(replayed.queued).toEqual([]);
  });
});
