import {
  defaultPetdexCapabilities,
  resolveAnimation,
  type PhysicalState
} from "@ai-partner/resolver";
import { type AnimationIntent, type PartnerStateSnapshot } from "@ai-partner/contracts";

export function resolvePartnerIntent(
  snapshot: PartnerStateSnapshot,
  physicalState: PhysicalState
): AnimationIntent {
  return resolveAnimation(snapshot, physicalState, defaultPetdexCapabilities);
}
