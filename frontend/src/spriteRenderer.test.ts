import {
  ANIMATION_INTENT_SCHEMA_VERSION,
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  type AnimationIntent,
  type PartnerStateSnapshot
} from "@ai-partner/contracts";
import { describe, expect, it } from "vitest";
import { resolvePartnerIntent } from "./animationIntentView";
import {
  normalizeSpriteColumn,
  petdexRowForAnimation,
  spriteRenderModelForIntent
} from "./spriteRenderer";

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
    updatedAt: "2026-06-06T00:00:00Z",
    paused: false,
    connection: "ok"
  };
}

describe("sprite renderer model", () => {
  it("maps resolver legacy animations to Petdex atlas rows", () => {
    const intent = resolvePartnerIntent(snapshot("reading"), "normal");
    const model = spriteRenderModelForIntent(intent, 3, "probe-atlas");

    expect(model.animation).toBe("legacy.review");
    expect(model.row).toBe("review");
    expect(model.frame).toMatchObject({
      row: "review",
      rowIndex: 8,
      columnIndex: 3,
      backgroundPosition: "-576px -1664px"
    });
    expect(model.style).toMatchObject({
      width: 192,
      height: 208,
      backgroundImage: 'url("probe-atlas")',
      backgroundSize: "1536px 1872px",
      backgroundPosition: "-576px -1664px"
    });
    expect(model.className).toBe("sprite-frame is-looping");
  });

  it("keeps physical procedural effects in DOM-ready classes", () => {
    const intent = resolvePartnerIntent(snapshot("waiting", "等待确认"), "struggling");
    const model = spriteRenderModelForIntent(intent, 1, "probe-atlas");

    expect(model.animation).toBe("legacy.running-left");
    expect(model.row).toBe("running-left");
    expect(model.procedural).toEqual(["shake"]);
    expect(model.className).toBe("sprite-frame is-looping effect-shake");
  });

  it("normalizes frame indexes before reading the atlas", () => {
    expect(normalizeSpriteColumn(10)).toBe(2);
    expect(normalizeSpriteColumn(-1)).toBe(7);
    expect(normalizeSpriteColumn(Number.NaN)).toBe(0);

    const intent = resolvePartnerIntent(snapshot("idle"), "normal");
    expect(spriteRenderModelForIntent(intent, 10, "probe-atlas").frame.columnIndex).toBe(2);
  });

  it("falls back unknown non-legacy body animations to the idle row", () => {
    const intent: AnimationIntent = {
      schemaVersion: ANIMATION_INTENT_SCHEMA_VERSION,
      body: {
        animation: "workflow.reading",
        procedural: [],
        loop: true
      },
      bubble: null,
      queued: []
    };

    expect(petdexRowForAnimation(intent.body.animation)).toBe("idle");
    expect(spriteRenderModelForIntent(intent, 0, "probe-atlas").row).toBe("idle");
  });
});
