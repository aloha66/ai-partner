import {
  defaultPetdexCapabilities,
  type PartnerCapabilities
} from "@ai-partner/resolver";
import {
  type CompanionCatalog,
  type LocalCompanion,
  type RuntimeCompanion
} from "./tauriWindow";

export interface ActiveCompanionView {
  id: string;
  name: string;
  source: string;
  status: string;
  valid: boolean;
  atlasUrl: string;
  capabilities: PartnerCapabilities;
  fallbackUsed: boolean;
}

export function activeCompanionView(
  catalog: CompanionCatalog | null,
  fallbackAtlasUrl: string
): ActiveCompanionView {
  const companion = catalog?.selectedCompanion;
  if (!companion || !companion.valid) {
    return defaultCompanionView(fallbackAtlasUrl, true);
  }

  return {
    id: companion.id,
    name: companion.displayName,
    source: companion.source,
    status: companion.status,
    valid: companion.valid,
    atlasUrl: atlasUrlFor(companion, fallbackAtlasUrl),
    capabilities: companion.capabilities,
    fallbackUsed: catalog.fallbackUsed
  };
}

export function canSwitchCompanion(companion: LocalCompanion, currentId: string): boolean {
  return companion.valid && companion.id !== currentId;
}

function defaultCompanionView(
  fallbackAtlasUrl: string,
  fallbackUsed: boolean
): ActiveCompanionView {
  return {
    id: "default-petdex",
    name: "Default Petdex",
    source: "builtin",
    status: "fallback",
    valid: true,
    atlasUrl: fallbackAtlasUrl,
    capabilities: defaultPetdexCapabilities,
    fallbackUsed
  };
}

function atlasUrlFor(companion: RuntimeCompanion, fallbackAtlasUrl: string): string {
  return companion.runtimeAtlasUrl && companion.runtimeAtlasUrl.length > 0
    ? companion.runtimeAtlasUrl
    : fallbackAtlasUrl;
}
