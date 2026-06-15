import { defaultPetdexCapabilities } from "@ai-partner/resolver";
import { describe, expect, it } from "vitest";
import {
  activeCompanionView,
  canSwitchCompanion
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
});
