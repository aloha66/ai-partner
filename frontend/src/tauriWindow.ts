import { invoke } from "@tauri-apps/api/core";
import {
  isRegistered,
  register,
  unregister
} from "@tauri-apps/plugin-global-shortcut";
import {
  cursorPosition,
  getCurrentWindow,
  PhysicalPosition
} from "@tauri-apps/api/window";

export const CLICK_THROUGH_RECOVERY_SHORTCUTS = [
  "CommandOrControl+Shift+KeyP",
  "CommandOrControl+Alt+Shift+KeyP"
];
const SHORTCUT_LABELS: Record<string, string> = {
  "CommandOrControl+Shift+KeyP": "Cmd+Shift+P",
  "CommandOrControl+Alt+Shift+KeyP": "Cmd+Opt+Shift+P"
};
export const CLICK_THROUGH_RECOVERY_SHORTCUT =
  "auto restore / shortcut";

export interface SpikeStatus {
  transparent: string;
  frameless: string;
  alwaysOnTop: string;
  focusPolicy: string;
  spaces: string;
  clickThroughRecovery: string;
}

export async function getSpikeStatus(): Promise<SpikeStatus> {
  return invoke<SpikeStatus>("m0_window_spike_status");
}

export async function applyM0WindowDefaults(): Promise<void> {
  const window = getCurrentWindow();
  await Promise.allSettled([
    window.setIgnoreCursorEvents(false),
    window.setAlwaysOnTop(true),
    window.setFocusable(false),
    window.setVisibleOnAllWorkspaces(false)
  ]);
}

export async function moveWindowTo(x: number, y: number): Promise<void> {
  await getCurrentWindow().setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
}

export async function currentWindowPosition(): Promise<{ x: number; y: number }> {
  return getCurrentWindow().outerPosition();
}

export async function currentCursorPosition(): Promise<{ x: number; y: number }> {
  return cursorPosition();
}

export async function enterClickThrough(): Promise<void> {
  await invoke("enter_click_through_for_ms", { durationMs: 6000 });
}

export async function leaveClickThrough(): Promise<void> {
  const window = getCurrentWindow();
  await window.setIgnoreCursorEvents(false);
  await window.setFocusable(false);
  await window.setAlwaysOnTop(true);
  await window.show();
}

export async function registerClickThroughRecovery(
  onRecovered: () => void
): Promise<{ cleanup: () => Promise<void>; shortcuts: string[]; errors: string[] }> {
  const registeredShortcuts: string[] = [];
  const errors: string[] = [];
  const recover = async (event: { state: string }) => {
    if (event.state !== "Pressed") {
      return;
    }
    await leaveClickThrough();
    onRecovered();
  };

  for (const shortcut of CLICK_THROUGH_RECOVERY_SHORTCUTS) {
    try {
      await register(shortcut, recover);
      if (await isRegistered(shortcut)) {
        registeredShortcuts.push(SHORTCUT_LABELS[shortcut] ?? shortcut);
      } else {
        errors.push(`${SHORTCUT_LABELS[shortcut] ?? shortcut}: not registered`);
      }
    } catch (error) {
      errors.push(`${SHORTCUT_LABELS[shortcut] ?? shortcut}: ${String(error)}`);
      await unregister(shortcut).catch(() => undefined);
    }
  }

  return {
    cleanup: async () => {
      await unregister(CLICK_THROUGH_RECOVERY_SHORTCUTS);
    },
    shortcuts: registeredShortcuts,
    errors
  };
}
