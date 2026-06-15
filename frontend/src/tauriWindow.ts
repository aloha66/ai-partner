import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PartnerStateSnapshot } from "@ai-partner/contracts";
import type { PartnerCapabilities } from "@ai-partner/resolver";
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
export const PARTNER_STATE_CHANGED_EVENT = "partner-state-changed";
export const CLICK_THROUGH_RESTORED_EVENT = "click-through-restored";

export interface SpikeStatus {
  transparent: string;
  frameless: string;
  alwaysOnTop: string;
  focusPolicy: string;
  spaces: string;
  clickThroughRecovery: string;
}

export interface StateCommandResult {
  snapshot: PartnerStateSnapshot;
  usedFallback: boolean;
  error?: string;
}

export interface CompanionCatalog {
  companions: LocalCompanion[];
  selectedCompanionId: string;
  selectedCompanion: LocalCompanion;
  fallbackUsed: boolean;
  status: string;
}

export interface LocalCompanion {
  id: string;
  partnerId: string;
  displayName: string;
  description?: string;
  rootPath?: string;
  spritesheetPath?: string;
  atlasUrl?: string;
  capabilities: PartnerCapabilities;
  valid: boolean;
  status: "valid" | "invalid" | "fallback" | string;
  errors: string[];
  source: string;
}

export interface RuntimeCompanion extends LocalCompanion {
  runtimeAtlasUrl?: string;
}

export async function getSpikeStatus(): Promise<SpikeStatus> {
  return invoke<SpikeStatus>("m0_window_spike_status");
}

export async function getCurrentState(): Promise<PartnerStateSnapshot> {
  return invoke<PartnerStateSnapshot>("get_current_state");
}

export async function listLocalCompanions(): Promise<CompanionCatalog> {
  return withRuntimeAtlasUrls(await invoke<CompanionCatalog>("list_local_companions"));
}

export async function setSelectedCompanion(companionId: string): Promise<CompanionCatalog> {
  return withRuntimeAtlasUrls(
    await invoke<CompanionCatalog>("set_selected_companion", { companionId })
  );
}

export async function openLocalPetsDirectory(source: "petdex" | "codex"): Promise<void> {
  await invoke("open_local_pets_directory", { source });
}

export async function quitApp(): Promise<void> {
  await invoke("quit_app");
}

export async function listenPartnerStateChanged(
  onSnapshot: (snapshot: PartnerStateSnapshot) => void
): Promise<UnlistenFn> {
  return listen<PartnerStateSnapshot>(PARTNER_STATE_CHANGED_EVENT, (event) => {
    onSnapshot(event.payload);
  });
}

export async function listenClickThroughRestored(
  onRestored: () => void
): Promise<UnlistenFn> {
  return listen(CLICK_THROUGH_RESTORED_EVENT, onRestored);
}

export async function pausePartner(): Promise<StateCommandResult> {
  return invokeStateCommandWithFallback("pause");
}

export async function resumePartner(): Promise<StateCommandResult> {
  return invokeStateCommandWithFallback("resume");
}

export async function clearPartnerError(): Promise<StateCommandResult> {
  return invokeStateCommandWithFallback("clear_error");
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

export async function setWindowFocusable(focusable: boolean): Promise<void> {
  await getCurrentWindow().setFocusable(focusable);
}

async function invokeStateCommandWithFallback(command: string): Promise<StateCommandResult> {
  try {
    return {
      snapshot: await invoke<PartnerStateSnapshot>(command),
      usedFallback: false
    };
  } catch (error) {
    return {
      snapshot: await getCurrentState(),
      usedFallback: true,
      error: String(error)
    };
  }
}

function withRuntimeAtlasUrls(catalog: CompanionCatalog): CompanionCatalog {
  const companions = catalog.companions.map(withRuntimeAtlasUrl);
  const selectedCompanion = withRuntimeAtlasUrl(catalog.selectedCompanion);

  return {
    ...catalog,
    companions,
    selectedCompanion
  };
}

function withRuntimeAtlasUrl(companion: LocalCompanion): RuntimeCompanion {
  return {
    ...companion,
    runtimeAtlasUrl:
      companion.atlasUrl ??
      (companion.spritesheetPath ? convertFileSrc(companion.spritesheetPath) : undefined)
  };
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
