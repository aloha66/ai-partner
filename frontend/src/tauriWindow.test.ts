import {
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  type PartnerStateSnapshot
} from "@ai-partner/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => {
  let stateHandler:
    | ((event: { payload: PartnerStateSnapshot }) => void)
    | undefined;
  let clickThroughRestoredHandler: (() => void) | undefined;

  return {
    invoke: vi.fn(),
    listen: vi.fn(
      async (
        eventName: string,
        handler: (event: { payload: PartnerStateSnapshot }) => void
      ) => {
        if (eventName === "partner-state-changed") {
          stateHandler = handler;
        } else if (eventName === "click-through-restored") {
          clickThroughRestoredHandler = handler as () => void;
        }
        return tauriMocks.unlisten;
      }
    ),
    unlisten: vi.fn(),
    getCurrentWindow: vi.fn(() => ({
      setIgnoreCursorEvents: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setFocusable: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setPosition: vi.fn(),
      outerPosition: vi.fn(),
      show: vi.fn()
    })),
    cursorPosition: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    isRegistered: vi.fn(),
    emitState(snapshot: PartnerStateSnapshot) {
      stateHandler?.({ payload: snapshot });
    },
    emitClickThroughRestored() {
      clickThroughRestoredHandler?.();
    },
    reset() {
      stateHandler = undefined;
      clickThroughRestoredHandler = undefined;
      tauriMocks.invoke.mockReset();
      tauriMocks.listen.mockClear();
      tauriMocks.unlisten.mockClear();
    }
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMocks.listen
}));

vi.mock("@tauri-apps/api/window", () => ({
  cursorPosition: tauriMocks.cursorPosition,
  getCurrentWindow: tauriMocks.getCurrentWindow,
  PhysicalPosition: class PhysicalPosition {
    constructor(
      readonly x: number,
      readonly y: number
    ) {}
  }
}));

vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  isRegistered: tauriMocks.isRegistered,
  register: tauriMocks.register,
  unregister: tauriMocks.unregister
}));

const readingSnapshot: PartnerStateSnapshot = {
  schemaVersion: PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  workflowState: "reading",
  runId: "run_debug_1",
  activeRunId: "run_debug_1",
  source: "cli",
  message: "reading through debug sender",
  priority: "normal",
  updatedAt: "2026-06-04T00:00:00Z",
  paused: false,
  connection: "ok"
};

const pausedSnapshot: PartnerStateSnapshot = {
  ...readingSnapshot,
  paused: true
};

describe("Tauri state bridge", () => {
  beforeEach(() => {
    tauriMocks.reset();
  });

  it("pulls the current state snapshot from Rust", async () => {
    tauriMocks.invoke.mockResolvedValueOnce(readingSnapshot);
    const { getCurrentState } = await import("./tauriWindow");

    await expect(getCurrentState()).resolves.toEqual(readingSnapshot);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("get_current_state");
  });

  it("subscribes to partner-state-changed event updates", async () => {
    const { listenPartnerStateChanged } = await import("./tauriWindow");
    const onSnapshot = vi.fn();

    await expect(listenPartnerStateChanged(onSnapshot)).resolves.toBe(
      tauriMocks.unlisten
    );
    tauriMocks.emitState(readingSnapshot);

    expect(tauriMocks.listen).toHaveBeenCalledWith(
      "partner-state-changed",
      expect.any(Function)
    );
    expect(onSnapshot).toHaveBeenCalledWith(readingSnapshot);
  });

  it("subscribes to click-through restored events", async () => {
    const { listenClickThroughRestored } = await import("./tauriWindow");
    const onRestored = vi.fn();

    await expect(listenClickThroughRestored(onRestored)).resolves.toBe(
      tauriMocks.unlisten
    );
    tauriMocks.emitClickThroughRestored();

    expect(tauriMocks.listen).toHaveBeenCalledWith(
      "click-through-restored",
      expect.any(Function)
    );
    expect(onRestored).toHaveBeenCalledOnce();
  });

  it("falls back to get_current_state when control commands fail", async () => {
    tauriMocks.invoke
      .mockRejectedValueOnce(new Error("pause unavailable"))
      .mockResolvedValueOnce(pausedSnapshot)
      .mockRejectedValueOnce(new Error("resume unavailable"))
      .mockResolvedValueOnce(readingSnapshot)
      .mockRejectedValueOnce(new Error("clear unavailable"))
      .mockResolvedValueOnce(readingSnapshot);
    const { clearPartnerError, pausePartner, resumePartner } = await import(
      "./tauriWindow"
    );

    await expect(pausePartner()).resolves.toEqual({
      snapshot: pausedSnapshot,
      usedFallback: true,
      error: "Error: pause unavailable"
    });
    await expect(resumePartner()).resolves.toEqual({
      snapshot: readingSnapshot,
      usedFallback: true,
      error: "Error: resume unavailable"
    });
    await expect(clearPartnerError()).resolves.toEqual({
      snapshot: readingSnapshot,
      usedFallback: true,
      error: "Error: clear unavailable"
    });

    expect(tauriMocks.invoke.mock.calls).toEqual([
      ["pause"],
      ["get_current_state"],
      ["resume"],
      ["get_current_state"],
      ["clear_error"],
      ["get_current_state"]
    ]);
  });

  it("returns direct command snapshots without fallback", async () => {
    tauriMocks.invoke.mockResolvedValueOnce(pausedSnapshot);
    const { pausePartner } = await import("./tauriWindow");

    await expect(pausePartner()).resolves.toEqual({
      snapshot: pausedSnapshot,
      usedFallback: false
    });
  });
});
