import {
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  type PartnerStateSnapshot
} from "@ai-partner/contracts";
import { describe, expect, it } from "vitest";
import {
  defaultPetdexCapabilities,
  resolveAnimation,
  type PartnerCapabilities,
  type PhysicalState
} from "../src";

function snapshot(
  workflowState: PartnerStateSnapshot["workflowState"],
  overrides: Partial<PartnerStateSnapshot> = {}
): PartnerStateSnapshot {
  return {
    schemaVersion: PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
    workflowState,
    runId: "run_test",
    activeRunId: "run_test",
    source: "cli",
    priority: "normal",
    updatedAt: "2026-06-02T00:00:00Z",
    paused: false,
    connection: "ok",
    ...overrides
  };
}

function withAnimations(
  animations: PartnerCapabilities["animations"],
  fallbacks: PartnerCapabilities["fallbacks"] = {}
): PartnerCapabilities {
  return {
    ...defaultPetdexCapabilities,
    animations: {
      ...defaultPetdexCapabilities.animations,
      ...animations
    },
    fallbacks: {
      ...defaultPetdexCapabilities.fallbacks,
      ...fallbacks
    }
  };
}

function withoutAnimations(...removed: string[]): PartnerCapabilities {
  const animations = { ...defaultPetdexCapabilities.animations };
  for (const animation of removed) {
    delete animations[animation as keyof typeof animations];
  }
  return {
    ...defaultPetdexCapabilities,
    animations
  };
}

describe("resolveAnimation", () => {
  it("uses workflow animation when reading is available and physical state is normal", () => {
    const intent = resolveAnimation(
      snapshot("reading"),
      "normal",
      withAnimations({
        "workflow.reading": {
          animation: "workflow.reading",
          loop: true
        }
      })
    );

    expect(intent.body.animation).toBe("workflow.reading");
    expect(intent.bubble).toMatchObject({
      state: "reading",
      text: "正在读取项目内容",
      priority: "normal"
    });
  });

  it("falls reading back to legacy review when workflow reading is missing", () => {
    const intent = resolveAnimation(snapshot("reading"), "normal", defaultPetdexCapabilities);

    expect(intent.body.animation).toBe("legacy.review");
    expect(intent.body.procedural).toEqual([]);
  });

  it("falls editing back to legacy running", () => {
    const intent = resolveAnimation(snapshot("editing"), "normal", defaultPetdexCapabilities);

    expect(intent.body.animation).toBe("legacy.running");
    expect(intent.bubble?.state).toBe("editing");
  });

  it("keeps waiting bubble high priority while carried body falls back with procedural motion", () => {
    const intent = resolveAnimation(
      snapshot("waiting", { message: "等待用户确认" }),
      "struggling",
      withoutAnimations("physical.struggling")
    );

    expect(intent.body.animation).toBe("legacy.running-left");
    expect(intent.body.procedural).toContain("shake");
    expect(intent.body.loop).toBe(true);
    expect(intent.bubble).toEqual({
      state: "waiting",
      text: "等待用户确认",
      priority: "high"
    });
  });

  it("falls error back to legacy failed and keeps high priority bubble", () => {
    const intent = resolveAnimation(snapshot("error"), "normal", defaultPetdexCapabilities);

    expect(intent.body.animation).toBe("legacy.failed");
    expect(intent.bubble).toMatchObject({
      state: "error",
      priority: "high"
    });
  });

  it("plays done immediately when physical state is normal", () => {
    const intent = resolveAnimation(
      snapshot("done"),
      "normal",
      withAnimations({
        "workflow.done": {
          animation: "workflow.done",
          loop: false
        }
      })
    );

    expect(intent.body.animation).toBe("workflow.done");
    expect(intent.body.loop).toBe(false);
    expect(intent.queued).toEqual([]);
  });

  it("queues done for five seconds when physical falling overrides body animation", () => {
    const now = new Date("2026-06-02T00:00:00Z");
    const intent = resolveAnimation(
      snapshot("done"),
      "falling",
      withAnimations({
        "workflow.done": {
          animation: "workflow.done",
          loop: false
        },
        "physical.falling": {
          animation: "physical.falling",
          loop: false,
          procedural: ["drop"]
        }
      }),
      { now }
    );

    expect(intent.body).toEqual({
      animation: "physical.falling",
      procedural: ["drop"],
      loop: false
    });
    expect(intent.bubble).toMatchObject({
      state: "done",
      text: "已完成"
    });
    expect(intent.queued).toEqual([
      {
        animation: "workflow.done",
        reason: "physical-override",
        expiresAt: "2026-06-02T00:00:05.000Z"
      }
    ]);
  });

  it("replays queued done when physical state returns to normal before expiry", () => {
    const intent = resolveAnimation(snapshot("idle"), "normal", defaultPetdexCapabilities, {
      now: new Date("2026-06-02T00:00:04Z"),
      queued: [
        {
          animation: "legacy.waving",
          reason: "physical-override",
          expiresAt: "2026-06-02T00:00:05Z"
        }
      ]
    });

    expect(intent.body.animation).toBe("legacy.waving");
    expect(intent.body.loop).toBe(false);
    expect(intent.queued).toEqual([]);
  });

  it("drops expired queued done animations", () => {
    const intent = resolveAnimation(snapshot("idle"), "normal", defaultPetdexCapabilities, {
      now: new Date("2026-06-02T00:00:06Z"),
      queued: [
        {
          animation: "legacy.waving",
          reason: "physical-override",
          expiresAt: "2026-06-02T00:00:05Z"
        }
      ]
    });

    expect(intent.body.animation).toBe("legacy.idle");
    expect(intent.queued).toEqual([]);
  });

  it("drops queued done animations when a new workflow state is active", () => {
    const intent = resolveAnimation(snapshot("reading"), "normal", defaultPetdexCapabilities, {
      now: new Date("2026-06-02T00:00:04Z"),
      queued: [
        {
          animation: "legacy.waving",
          reason: "physical-override",
          expiresAt: "2026-06-02T00:00:05Z"
        }
      ]
    });

    expect(intent.body.animation).toBe("legacy.review");
    expect(intent.queued).toEqual([]);
  });

  it("does not refresh queued done expiry while physical override continues", () => {
    const intent = resolveAnimation(snapshot("done"), "falling", defaultPetdexCapabilities, {
      now: new Date("2026-06-02T00:00:03Z"),
      queued: [
        {
          animation: "legacy.waving",
          reason: "physical-override",
          expiresAt: "2026-06-02T00:00:05Z"
        }
      ]
    });

    expect(intent.body.animation).toBe("legacy.idle");
    expect(intent.body.procedural).toContain("drop");
    expect(intent.queued).toEqual([
      {
        animation: "legacy.waving",
        reason: "physical-override",
        expiresAt: "2026-06-02T00:00:05Z"
      }
    ]);
  });

  it.each(["normal", "carried", "recovering"] satisfies PhysicalState[])(
    "keeps idle non-blank for physical state %s",
    (physicalState) => {
      const intent = resolveAnimation(snapshot("idle"), physicalState, defaultPetdexCapabilities);

      expect(intent.body.animation).toMatch(/^legacy\./);
    }
  );
});
