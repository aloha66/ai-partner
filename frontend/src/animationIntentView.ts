import {
  defaultPetdexCapabilities,
  resolveAnimation,
  type PartnerCapabilities,
  type ResolveAnimationOptions,
  type PhysicalState
} from "@ai-partner/resolver";
import { type AnimationIntent, type PartnerStateSnapshot } from "@ai-partner/contracts";

export interface ResolvePartnerIntentOptions extends ResolveAnimationOptions {
  capabilities?: PartnerCapabilities;
}

export function resolvePartnerIntent(
  snapshot: PartnerStateSnapshot,
  physicalState: PhysicalState,
  options: ResolvePartnerIntentOptions = {}
): AnimationIntent {
  const {
    capabilities = defaultPetdexCapabilities,
    ...resolverOptions
  } = options;

  return resolveAnimation(snapshot, physicalState, capabilities, resolverOptions);
}
