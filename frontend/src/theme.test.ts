import { describe, expect, it, vi } from "vitest";
import {
  readStoredTheme,
  resolveTheme,
  storeTheme,
  themeLabel
} from "./theme";

describe("theme preference", () => {
  it("resolves system, light, and dark preferences", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("persists only known theme preferences", () => {
    const storage = {
      value: "dark",
      getItem: vi.fn(() => storage.value),
      setItem: vi.fn((_: string, value: string) => {
        storage.value = value;
      })
    };

    expect(readStoredTheme(storage)).toBe("dark");
    storeTheme(storage, "light");
    expect(storage.setItem).toHaveBeenCalledWith("ai-partner.theme", "light");
    storage.value = "neon";
    expect(readStoredTheme(storage)).toBe("system");
  });

  it("returns compact menu labels", () => {
    expect(themeLabel("system")).toBe("跟随系统");
    expect(themeLabel("light")).toBe("浅色");
    expect(themeLabel("dark")).toBe("暗黑");
  });
});

