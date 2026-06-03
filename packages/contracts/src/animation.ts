import { type SnapshotPriority } from "./snapshot";
import { type WorkflowState } from "./workflow";
import { ANIMATION_INTENT_SCHEMA_VERSION } from "./versions";

export type AnimationNamespace = "workflow" | "physical" | "legacy";
export type AnimationRef = `${AnimationNamespace}.${string}`;
export type ProceduralEffect = "shake" | "squash" | "float" | "drop";

export interface BodyAnimationIntent {
  animation: AnimationRef;
  procedural: ProceduralEffect[];
  loop: boolean;
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
