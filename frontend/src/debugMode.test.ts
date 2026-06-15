import { describe, expect, it } from "vitest";
import { resolveDebugMode } from "./debugMode";

describe("debug mode gating", () => {
  it("hides the debug panel by default in release builds", () => {
    expect(resolveDebugMode({ dev: false, mode: "production" })).toBe("hidden");
  });

  it("reveals diagnostics in dev builds or with debug flags", () => {
    expect(resolveDebugMode({ dev: true, mode: "development" })).toBe("visible");
    expect(resolveDebugMode({ dev: false, mode: "production", appDebug: "1" })).toBe(
      "visible"
    );
    expect(resolveDebugMode({ dev: false, mode: "production", viteDebug: "true" })).toBe(
      "visible"
    );
  });

  it("allows explicit false flags to hide diagnostics in dev builds", () => {
    expect(resolveDebugMode({ dev: true, mode: "development", appDebug: "false" })).toBe(
      "hidden"
    );
    expect(resolveDebugMode({ dev: true, mode: "development", viteDebug: "0" })).toBe(
      "hidden"
    );
  });
});

