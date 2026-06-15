import { defaultPetdexCapabilities } from "@ai-partner/resolver";
import { describe, expect, it } from "vitest";
import {
  activeCompanionView,
  canSwitchCompanion,
  companionSelectorOptions,
  filterCompanions,
  invalidReason,
  sourceLabel
} from "./companionSelector";
import type { CompanionCatalog, LocalCompanion, RuntimeCompanion } from "./tauriWindow";

const capabilities = {
  ...defaultPetdexCapabilities,
  partnerId: "anya"
};

function companion(overrides: Partial<RuntimeCompanion> = {}): RuntimeCompanion {
  return {
    id: "petdex:anya-2",
    partnerId: "anya",
    displayName: "Anya",
    runtimeAtlasUrl: "asset://localhost/anya",
    capabilities,
    valid: true,
    status: "valid",
    errors: [],
    source: "petdex",
    ...overrides
  };
}

describe("companion selector view model", () => {
  it("uses the selected local companion atlas and capabilities", () => {
    const catalog: CompanionCatalog = {
      companions: [companion()],
      selectedCompanionId: "petdex:anya-2",
      selectedCompanion: companion(),
      fallbackUsed: false,
      status: "selected"
    };

    expect(activeCompanionView(catalog, "probe")).toMatchObject({
      id: "petdex:anya-2",
      name: "Anya",
      atlasUrl: "asset://localhost/anya",
      capabilities,
      fallbackUsed: false
    });
  });

  it("falls back to the probe atlas when the selected asset is missing or invalid", () => {
    expect(activeCompanionView(null, "probe")).toMatchObject({
      id: "default-petdex",
      atlasUrl: "probe",
      capabilities: defaultPetdexCapabilities,
      fallbackUsed: true
    });

    const catalog: CompanionCatalog = {
      companions: [],
      selectedCompanionId: "default-petdex",
      selectedCompanion: companion({ valid: false, status: "invalid" }),
      fallbackUsed: true,
      status: "fallback"
    };

    expect(activeCompanionView(catalog, "probe")).toMatchObject({
      id: "default-petdex",
      atlasUrl: "probe",
      fallbackUsed: true
    });
  });

  it("only allows switching to valid non-current companions", () => {
    expect(canSwitchCompanion(companion(), "petdex:artoria")).toBe(true);
    expect(canSwitchCompanion(companion(), "petdex:anya-2")).toBe(false);
    expect(
      canSwitchCompanion(companion({ valid: false }) as LocalCompanion, "petdex:artoria")
    ).toBe(false);
  });

  it("filters companions by display name, source, id, and invalid reason", () => {
    const companions = [
      companion(),
      companion({
        id: "codex:artoria",
        partnerId: "artoria",
        displayName: "Artoria",
        source: "codex"
      }),
      companion({
        id: "petdex:broken",
        partnerId: "broken",
        displayName: "Broken",
        valid: false,
        status: "invalid",
        errors: ["spritesheet missing"]
      }) as LocalCompanion
    ];

    expect(filterCompanions(companions, "art").map((item) => item.id)).toEqual([
      "codex:artoria"
    ]);
    expect(filterCompanions(companions, "Codex").map((item) => item.id)).toEqual([
      "codex:artoria"
    ]);
    expect(filterCompanions(companions, "missing").map((item) => item.id)).toEqual([
      "petdex:broken"
    ]);
  });

  it("builds selector options with product source labels, duplicate names, and invalid reasons", () => {
    const petdexArtoria = companion({
      id: "petdex:artoria",
      partnerId: "artoria",
      displayName: "Artoria",
      source: "petdex"
    });
    const codexArtoria = companion({
      id: "codex:artoria",
      partnerId: "artoria",
      displayName: "Artoria",
      source: "codex"
    });
    const invalid = companion({
      id: "petdex:broken",
      partnerId: "broken",
      displayName: "Broken",
      valid: false,
      status: "invalid",
      errors: ["spritesheet dimensions unavailable"]
    }) as LocalCompanion;
    const catalog: CompanionCatalog = {
      companions: [petdexArtoria, codexArtoria, invalid],
      selectedCompanionId: "codex:artoria",
      selectedCompanion: codexArtoria,
      fallbackUsed: false,
      status: "selected"
    };

    const options = companionSelectorOptions(catalog, "codex:artoria", "");

    expect(options).toMatchObject([
      {
        selected: false,
        switchable: true,
        sourceLabel: "Petdex",
        duplicateName: true
      },
      {
        selected: true,
        switchable: false,
        sourceLabel: "Codex Desktop",
        duplicateName: true
      },
      {
        selected: false,
        switchable: false,
        reason: "spritesheet dimensions unavailable",
        duplicateName: false
      }
    ]);
  });

  it("labels known sources and returns invalid companion reasons", () => {
    expect(sourceLabel("petdex")).toBe("Petdex");
    expect(sourceLabel("codex")).toBe("Codex Desktop");
    expect(sourceLabel("builtin")).toBe("Built-in");
    expect(invalidReason(companion({ valid: false, errors: [] }) as LocalCompanion)).toBe(
      "Invalid companion asset"
    );
  });
});
