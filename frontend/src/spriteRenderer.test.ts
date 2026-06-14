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
  normalizeSpriteColumnForRow,
  petdexRowForAnimation,
  SPRITE_RENDER_HEIGHT,
  SPRITE_RENDER_SCALE_X,
  SPRITE_RENDER_SCALE_Y,
  SPRITE_RENDER_WIDTH,
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
  it("uses the enlarged target sprite size for the 520x360 renderer footprint", () => {
    expect(SPRITE_RENDER_WIDTH).toBe(173);
    expect(SPRITE_RENDER_HEIGHT).toBe(187);
    expect(SPRITE_RENDER_SCALE_X).toBeCloseTo(173 / 192);
    expect(SPRITE_RENDER_SCALE_Y).toBeCloseTo(187 / 208);
    const model = spriteRenderModelForIntent(resolvePartnerIntent(snapshot("idle"), "normal"), 0, "probe-atlas");

    expect(model.style).toMatchObject({
      width: 173,
      height: 187
    });
    expect(model.atlasStyle).toMatchObject({
      width: 1384,
      height: 1683,
      transform: "translate3d(-0px, -0px, 0)"
    });
    expect(spriteRenderModelForIntent(resolvePartnerIntent(snapshot("idle"), "normal"), 0, "asset://localhost/%2Ftmp%2Fspritesheet.webp").atlasKind).toBe("asset");
    expect(spriteRenderModelForIntent(resolvePartnerIntent(snapshot("idle"), "normal"), 0, "data:image/svg+xml,probe").atlasKind).toBe("probe");
    expect(spriteRenderModelForIntent(resolvePartnerIntent(snapshot("idle"), "normal"), 0, "https://example.test/spritesheet.webp").atlasKind).toBe("url");
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
      width: 173,
      height: 187
    });
    expect(model.atlasUrl).toBe("probe-atlas");
    expect(model.atlasStyle).toMatchObject({
      width: 1384,
      height: 1683,
      transform: "translate3d(-519px, -1496px, 0)"
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
    const intent = resolvePartnerIntent(snapshot("waiting", "等待确认"), "struggling", {
      physicalContext: {
        horizontalDirection: "right"
      }
    });
    const model = spriteRenderModelForIntent(intent, 1, "probe-atlas");

    expect(model.animation).toBe("legacy.running-right");
    expect(model.row).toBe("running-right");
    expect(model.procedural).toEqual(["shake"]);
    expect(model.className).toBe("sprite-frame is-looping effect-shake");
  });

  it("renders replayed queued done through the same sprite model", () => {
    const doneWhileFalling = resolvePartnerIntent(snapshot("done"), "falling", {
      now: new Date("2026-06-06T00:00:00Z")
    });
    const replayed = resolvePartnerIntent(snapshot("idle"), "normal", {
      now: new Date("2026-06-06T00:00:04Z"),
      queued: doneWhileFalling.queued
    });
    const model = spriteRenderModelForIntent(replayed, 4, "probe-atlas");

    expect(replayed.body.animation).toBe("legacy.waving");
    expect(model.animation).toBe("legacy.waving");
    expect(model.row).toBe("waving");
    expect(model.loop).toBe(false);
    expect(model.className).toBe("sprite-frame is-once");
    expect(model.frame).toMatchObject({
      row: "waving",
      columnIndex: 0
    });
  });

  it("normalizes frame indexes before reading the atlas", () => {
    expect(normalizeSpriteColumn(10)).toBe(2);
    expect(normalizeSpriteColumn(-1)).toBe(7);
    expect(normalizeSpriteColumn(Number.NaN)).toBe(0);

    const intent = resolvePartnerIntent(snapshot("idle"), "normal");
    expect(spriteRenderModelForIntent(intent, 10, "probe-atlas").frame.columnIndex).toBe(4);
  });

  it("skips Petdex transparent padding columns for rows with fewer visible frames", () => {
    expect(normalizeSpriteColumnForRow("waiting", 5)).toBe(5);
    expect(normalizeSpriteColumnForRow("waiting", 6)).toBe(0);
    expect(normalizeSpriteColumnForRow("waving", 4)).toBe(0);
    expect(normalizeSpriteColumnForRow("jumping", -1)).toBe(4);

    const waiting = spriteRenderModelForIntent(
      resolvePartnerIntent(snapshot("waiting"), "normal"),
      7,
      "probe-atlas"
    );

    expect(waiting.row).toBe("waiting");
    expect(waiting.frame.columnIndex).toBe(1);
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
