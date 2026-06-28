import { type SnapshotPriority } from "./snapshot";
import { type WorkflowState } from "./workflow";
import { ANIMATION_INTENT_SCHEMA_VERSION } from "./versions";

export type AnimationNamespace = "workflow" | "physical" | "legacy";
export type AnimationRef = `${AnimationNamespace}.${string}`;
export type ProceduralEffect = "shake" | "squash" | "float" | "drop";
export type PetdexRow =
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
  row: PetdexRow;
  frameCount: number;
  fps: number;
}

export interface PngSequenceFrameSource {
  kind: "png-sequence";
  frames: string[];
  fps: number;
}

export interface MissingFrameSource {
  kind: "missing";
  reason: "animation-unavailable";
}

export type AnimationFrameSource =
  | PetdexRowFrameSource
  | PngSequenceFrameSource
  | MissingFrameSource;

export interface BodyAnimationIntent {
  animation: AnimationRef;
  procedural: ProceduralEffect[];
  loop: boolean;
  source: AnimationFrameSource;
}

export interface BubbleIntent {
  state: WorkflowState;
  text: string;
  priority: SnapshotPriority;
}

export interface QueuedAnimationIntent {
  animation: AnimationRef;
  reason: "physical-override";
  expiresAt: string;
}

export interface AnimationIntent {
  schemaVersion: typeof ANIMATION_INTENT_SCHEMA_VERSION;
  body: BodyAnimationIntent;
  bubble: BubbleIntent | null;
  queued: QueuedAnimationIntent[];
}
