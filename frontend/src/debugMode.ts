export type DebugMode = "hidden" | "visible";

export interface DebugModeEnv {
  dev: boolean;
  mode?: string;
  viteDebug?: string;
  appDebug?: string;
}

export function resolveDebugMode(env: DebugModeEnv): DebugMode {
  if (truthyFlag(env.appDebug) || truthyFlag(env.viteDebug)) {
    return "visible";
  }
  if (falsyFlag(env.appDebug) || falsyFlag(env.viteDebug)) {
    return "hidden";
  }
  return env.dev || env.mode === "development" ? "visible" : "hidden";
}

function truthyFlag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function falsyFlag(value: string | undefined): boolean {
  return value === "0" || value === "false" || value === "no" || value === "off";
}

