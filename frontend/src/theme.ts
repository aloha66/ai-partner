export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "ai-partner.theme";
const THEME_VALUES = new Set<ThemePreference>(["system", "light", "dark"]);

export function readStoredTheme(storage: Pick<Storage, "getItem">): ThemePreference {
  const value = storage.getItem(THEME_STORAGE_KEY);
  return THEME_VALUES.has(value as ThemePreference) ? (value as ThemePreference) : "system";
}

export function storeTheme(
  storage: Pick<Storage, "setItem">,
  preference: ThemePreference
): void {
  storage.setItem(THEME_STORAGE_KEY, preference);
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean
): ResolvedTheme {
  if (preference === "system") {
    return systemDark ? "dark" : "light";
  }
  return preference;
}

export function themeLabel(preference: ThemePreference): string {
  if (preference === "light") {
    return "浅色";
  }
  if (preference === "dark") {
    return "暗黑";
  }
  return "跟随系统";
}

