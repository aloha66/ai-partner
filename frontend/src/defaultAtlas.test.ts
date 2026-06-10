import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAtlasUrl } from "./defaultAtlas";
import { buildProbeAtlasDataUrl } from "./spriteProbe";

describe("default atlas configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the generated probe atlas when no golden asset URL is configured", () => {
    expect(defaultAtlasUrl()).toBe(buildProbeAtlasDataUrl());
  });

  it("keeps App wired to a single default atlas provider, not partner selection UI", async () => {
    const readFile = await import("node:fs/promises");
    const source = await readFile.readFile(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain("defaultAtlasUrl()");
    expect(source).not.toMatch(/scanAssetsRoot|partner selector|pet search|marketplace/i);
  });

  it("uses the build-time golden asset data URL when configured", async () => {
    vi.stubEnv("VITE_AI_PARTNER_DEFAULT_ATLAS_DATA_URL", "data:image/png;base64,real");

    expect(defaultAtlasUrl()).toBe("data:image/png;base64,real");
  });

  it("keeps direct URL override available for browser-only smoke paths", () => {
    vi.stubEnv("VITE_AI_PARTNER_DEFAULT_ATLAS_URL", "data:image/webp;base64,abc");

    expect(defaultAtlasUrl()).toBe("data:image/webp;base64,abc");
  });

  it("uses an inlined golden asset data URL before direct URL overrides when present", () => {
    vi.stubEnv("VITE_AI_PARTNER_DEFAULT_ATLAS_DATA_URL", "data:image/webp;base64,real");
    vi.stubEnv("VITE_AI_PARTNER_DEFAULT_ATLAS_URL", "data:image/webp;base64,url");

    expect(defaultAtlasUrl()).toBe("data:image/webp;base64,real");
  });
});
