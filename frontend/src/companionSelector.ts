import {
  defaultPetdexCapabilities,
  type PartnerCapabilities
} from "@ai-partner/resolver";
import {
  type CompanionCatalog,
  type LocalCompanion,
  type RuntimeCompanion
} from "./tauriWindow";

export type CompanionSource = "petdex" | "codex" | "builtin" | string;

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

export interface CompanionSelectorOption {
  companion: LocalCompanion;
  selected: boolean;
  switchable: boolean;
  sourceLabel: string;
  sourceDetail: string;
  reason: string;
  duplicateName: boolean;
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

export function filterCompanions(
  companions: LocalCompanion[],
  query: string
): LocalCompanion[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return companions;
  }

  return companions.filter((companion) => {
    const haystack = [
      companion.displayName,
      companion.partnerId,
      companion.source,
      companion.status,
      companion.id,
      ...companion.errors
    ]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(normalized);
  });
}

export function companionSelectorOptions(
  catalog: CompanionCatalog | null,
  activeId: string,
  query: string
): CompanionSelectorOption[] {
  const companions = filterCompanions(catalog?.companions ?? [], query);
  const nameCounts = new Map<string, number>();
  for (const companion of catalog?.companions ?? []) {
    const key = companion.displayName.trim().toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return companions.map((companion) => {
    const selected = companion.id === activeId;
    const duplicateName =
      (nameCounts.get(companion.displayName.trim().toLocaleLowerCase()) ?? 0) > 1;
    return {
      companion,
      selected,
      switchable: canSwitchCompanion(companion, activeId),
      sourceLabel: sourceLabel(companion.source),
      sourceDetail: duplicateName ? `${sourceLabel(companion.source)} source` : sourceLabel(companion.source),
      reason: invalidReason(companion),
      duplicateName
    };
  });
}

export function sourceLabel(source: CompanionSource): string {
  if (source === "petdex") {
    return "Petdex";
  }
  if (source === "codex") {
    return "Codex Desktop";
  }
  if (source === "builtin") {
    return "Built-in";
  }
  return source;
}

export function invalidReason(companion: LocalCompanion): string {
  if (companion.valid) {
    return "";
  }
  return companion.errors[0] ?? "Invalid companion asset";
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
