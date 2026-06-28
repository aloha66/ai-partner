import {
  type AnimationRef,
  type ProceduralEffect
} from "@ai-partner/contracts";

export type PetdexAnimationRow =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export interface PetdexRowFrameSource {
  kind: "petdex-row";
  row: PetdexAnimationRow;
  frameCount: number;
  fps: number;
}

export interface PngSequenceFrameSource {
  kind: "png-sequence";
  frames: string[];
  fps: number;
}

export type AnimationFrameSource = PetdexRowFrameSource | PngSequenceFrameSource;

export interface AnimationTimeline {
  animation: AnimationRef;
  loop: boolean;
  procedural?: ProceduralEffect[];
  source?: AnimationFrameSource;
}

export interface AssetRuntimeLimits {
  frameWidth: number;
  frameHeight: number;
  maxFramesPerAnimation: number;
  minFps: number;
  maxFps: number;
}

export interface PartnerCapabilities {
  partnerId: string;
  animations: Partial<Record<AnimationRef, AnimationTimeline>>;
  fallbacks: Partial<Record<AnimationRef, AnimationRef[]>>;
  runtimeLimits: AssetRuntimeLimits;
}

export const defaultRuntimeLimits: AssetRuntimeLimits = {
  frameWidth: 192,
  frameHeight: 208,
  maxFramesPerAnimation: 32,
  minFps: 1,
  maxFps: 24
};

export const petdexLegacyAnimations = [
  "legacy.idle",
  "legacy.running-right",
  "legacy.running-left",
  "legacy.waving",
  "legacy.jumping",
  "legacy.failed",
  "legacy.waiting",
  "legacy.running",
  "legacy.review"
] as const satisfies readonly AnimationRef[];

export const petdexLegacyRows = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review"
] as const satisfies readonly PetdexAnimationRow[];

export const petdexLegacyRowByAnimation = Object.fromEntries(
  petdexLegacyAnimations.map((animation, index) => [animation, petdexLegacyRows[index]])
) as Record<(typeof petdexLegacyAnimations)[number], PetdexAnimationRow>;

export const petdexLegacyFrameCounts: Record<PetdexAnimationRow, number> = {
  idle: 6,
  "running-right": 8,
  "running-left": 8,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6
};

export const DEFAULT_PETDEX_FPS = 6;

export const defaultFallbacks: Record<AnimationRef, AnimationRef[]> = {
  "workflow.idle": ["legacy.idle"],
  "workflow.running": ["legacy.running", "legacy.idle"],
  "workflow.reading": ["legacy.review", "legacy.running", "legacy.idle"],
  "workflow.editing": ["legacy.running", "legacy.review", "legacy.idle"],
  "workflow.waiting": ["legacy.waiting", "legacy.idle"],
  "workflow.error": ["legacy.failed", "legacy.idle"],
  "workflow.done": ["legacy.waving", "legacy.jumping", "legacy.idle"],
  "physical.carried": ["legacy.idle"],
  "physical.struggling": ["legacy.running-left", "legacy.running-right", "legacy.idle"],
  "physical.falling": ["legacy.idle"],
  "physical.recovering": ["legacy.idle"]
};

export const defaultPetdexCapabilities: PartnerCapabilities = {
  partnerId: "default-petdex",
  animations: Object.fromEntries(
    petdexLegacyAnimations.map((animation) => [
      animation,
      {
        animation,
        loop: animation !== "legacy.waving" && animation !== "legacy.jumping",
        procedural: [],
        source: {
          kind: "petdex-row",
          row: petdexLegacyRowByAnimation[animation],
          frameCount: petdexLegacyFrameCounts[petdexLegacyRowByAnimation[animation]],
          fps: DEFAULT_PETDEX_FPS
        }
      }
    ])
  ),
  fallbacks: defaultFallbacks,
  runtimeLimits: defaultRuntimeLimits
};

export function mergeWithDefaultFallbacks(
  capabilities: PartnerCapabilities
): PartnerCapabilities {
  return {
    ...capabilities,
    fallbacks: {
      ...defaultFallbacks,
      ...capabilities.fallbacks
    }
  };
}
