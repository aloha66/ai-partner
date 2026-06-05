import {
  defaultPetdexCapabilities,
  resolveAnimation,
  type PhysicalState
} from "@ai-partner/resolver";
import { type AnimationIntent, type AnimationRef, type PartnerStateSnapshot } from "@ai-partner/contracts";
import { type PetdexRow } from "@ai-partner/assets/petdex";

const legacyRowByAnimation: Partial<Record<AnimationRef, PetdexRow>> = {
  "legacy.idle": "idle",
  "legacy.running-right": "running-right",
  "legacy.running-left": "running-left",
  "legacy.waving": "waving",
  "legacy.jumping": "jumping",
  "legacy.failed": "failed",
  "legacy.waiting": "waiting",
  "legacy.running": "running",
  "legacy.review": "review"
};

export function resolvePartnerIntent(
  snapshot: PartnerStateSnapshot,
  physicalState: PhysicalState
): AnimationIntent {
  return resolveAnimation(snapshot, physicalState, defaultPetdexCapabilities);
}

export function petdexRowForIntent(intent: AnimationIntent): PetdexRow {
  return legacyRowByAnimation[intent.body.animation] ?? "idle";
}
