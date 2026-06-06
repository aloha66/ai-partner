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
  spriteRenderModelForIntent,
  DEFAULT_SPRITE_SCALE
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
  it("uses an integer default scale for the 520x360 renderer footprint", () => {
    expect(DEFAULT_SPRITE_SCALE).toBe(0.875);
    const model = spriteRenderModelForIntent(resolvePartnerIntent(snapshot("idle"), "normal"), 0, "probe-atlas");

    expect(model.style).toMatchObject({
      width: 168,
      height: 182,
      backgroundSize: "1344px 1638px",
      backgroundPosition: "-0px -0px"
    });
  });

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
      width: 168,
      height: 182,
      backgroundImage: 'url("probe-atlas")',
      backgroundSize: "1344px 1638px",
      backgroundPosition: "-504px -1456px"
    });
    expect(model.className).toBe("sprite-frame is-looping");
  });

  it("maps loaded canonical resolver intents to Petdex probe rows", () => {
    const intent = resolvePartnerIntent(snapshot("reading"), "normal", {
      capabilities: {
        partnerId: "loaded-partner",
        animations: {
          "workflow.reading": {
            animation: "workflow.reading",
            loop: true
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
      }
    });
    const model = spriteRenderModelForIntent(intent, 2, "probe-atlas");

    expect(model.animation).toBe("workflow.reading");
    expect(model.row).toBe("review");
    expect(model.frame).toMatchObject({
      row: "review",
      columnIndex: 2
    });
  });

  it("keeps every default workflow state on a visible Petdex probe row", () => {
    expect(Object.fromEntries(
      (["idle", "running", "reading", "editing", "waiting", "error", "done"] as const).map(
        (workflowState) => {
          const model = spriteRenderModelForIntent(
            resolvePartnerIntent(snapshot(workflowState), "normal"),
            0,
            "probe-atlas"
          );
          return [workflowState, model.row];
        }
      )
    )).toEqual({
      idle: "idle",
      running: "running",
      reading: "review",
      editing: "running",
      waiting: "waiting",
      error: "failed",
      done: "waving"
    });
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

  it("maps canonical intent refs to default Petdex rows before legacy fallback", () => {
    const canonicalByRow: Array<[AnimationIntent["body"]["animation"], string]> = [
      ["workflow.idle", "idle"],
      ["workflow.running", "running"],
      ["workflow.reading", "review"],
      ["workflow.editing", "running"],
      ["workflow.waiting", "waiting"],
      ["workflow.error", "failed"],
      ["workflow.done", "waving"],
      ["physical.carried", "idle"],
      ["physical.struggling", "running-left"],
      ["physical.falling", "idle"],
      ["physical.recovering", "idle"]
    ];

    expect(Object.fromEntries(canonicalByRow.map(([animation]) => [
      animation,
      petdexRowForAnimation(animation)
    ]))).toEqual(Object.fromEntries(canonicalByRow));
  });

  it("falls back unknown non-legacy body animations to the idle row", () => {
    const intent: AnimationIntent = {
      schemaVersion: ANIMATION_INTENT_SCHEMA_VERSION,
      body: {
        animation: "workflow.unknown",
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
