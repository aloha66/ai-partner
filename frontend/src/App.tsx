import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  CircleX,
  Focus,
  Layers2,
  MousePointer2,
  Move,
  ScanLine,
  ShieldCheck,
  UserRound,
  XCircle
} from "lucide-react";
import { type AnimationIntent } from "@ai-partner/contracts";
import { type PhysicalHorizontalDirection } from "@ai-partner/resolver";
import {
  applyM0WindowDefaults,
  clearPartnerError,
  currentCursorPosition,
  currentWindowPosition,
  enterClickThrough,
  getCurrentState,
  getSpikeStatus,
  leaveClickThrough,
  listenClickThroughRestored,
  listenPartnerStateChanged,
  listLocalCompanions,
  moveWindowTo,
  pausePartner,
  registerClickThroughRecovery,
  resumePartner,
  setSelectedCompanion,
  type StateCommandResult,
  type SpikeStatus,
  type CompanionCatalog,
  type LocalCompanion
} from "./tauriWindow";
import {
  idlePartnerState,
  partnerStateDisplay
} from "./partnerStateView";
import {
  resolvePartnerIntent
} from "./animationIntentView";
import {
  initialPhysicalMachineState,
  physicalStateMachine,
  type PhysicalMachineEvent
} from "./physicalStateMachine";
import { PartnerRenderer } from "./spriteRenderer";
import { defaultAtlasUrl } from "./defaultAtlas";
import {
  activeCompanionView,
  canSwitchCompanion
} from "./companionSelector";
import "./styles.css";

type DragState = {
  windowStartX: number;
  windowStartY: number;
  cursorStartX: number;
  cursorStartY: number;
  latestX: number;
  latestY: number;
  raf: number | null;
};

type PhysicalTimerName = "struggle" | "land" | "recover";

const DRAG_DIRECTION_THRESHOLD_PX = 1;

const checks = [
  ["transparent", "透明"],
  ["frameless", "无边框"],
  ["alwaysOnTop", "置顶"],
  ["focusPolicy", "焦点"],
  ["clickThroughRecovery", "穿透恢复"],
  ["spaces", "Spaces"]
] as const;

const statusLabels: Partial<Record<keyof SpikeStatus, Record<string, string>>> = {
  focusPolicy: {
    "accessory + focus:false + focusable:false": "accessory"
  },
  spaces: {
    "visibleOnAllWorkspaces:false": "normal only"
  },
  clickThroughRecovery: {
    "global shortcut": "shortcut",
    "backend auto restore": "auto 6s"
  }
};

function statusText(status: SpikeStatus | null, key: keyof SpikeStatus): string {
  const value = status?.[key] ?? "待运行";
  return statusLabels[key]?.[value] ?? value;
}

function runtimeRunStatus(runLabel: string): string {
  return runLabel === "no active run" ? "r0" : "r1";
}

function queuedAnimationsEqual(
  left: AnimationIntent["queued"],
  right: AnimationIntent["queued"]
): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return (
      item.animation === other.animation &&
      item.reason === other.reason &&
      item.expiresAt === other.expiresAt
    );
  });
}

export function App() {
  const [status, setStatus] = useState<SpikeStatus | null>(null);
  const [clickThrough, setClickThrough] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState("auto");
  const [partnerState, setPartnerState] = useState(idlePartnerState);
  const [stateCommandStatus, setStateCommandStatus] = useState("ok");
  const [queuedAnimations, setQueuedAnimations] = useState<AnimationIntent["queued"]>([]);
  const recoveryTimerRef = useRef<number | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const fallbackAtlasUrl = useMemo(() => defaultAtlasUrl(), []);
  const [companionCatalog, setCompanionCatalog] = useState<CompanionCatalog | null>(null);
  const [companionStatus, setCompanionStatus] = useState("scan");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [atlasFailed, setAtlasFailed] = useState(false);
  const [physicalMachine, dispatchPhysical] = useReducer(
    physicalStateMachine,
    initialPhysicalMachineState
  );
  const [dragDirection, setDragDirection] = useState<PhysicalHorizontalDirection | undefined>();
  const dragDirectionRef = useRef<PhysicalHorizontalDirection | undefined>(undefined);
  const dragRef = useRef<DragState | null>(null);
  const dragAttemptRef = useRef(0);
  const physicalTimersRef = useRef<Record<PhysicalTimerName, number | null>>({
    struggle: null,
    land: null,
    recover: null
  });
  const stateRevisionRef = useRef(0);
  const physicalState = physicalMachine.state;
  const dragging = physicalState === "carried" || physicalState === "struggling";
  const activeCompanion = useMemo(
    () => activeCompanionView(atlasFailed ? null : companionCatalog, fallbackAtlasUrl),
    [atlasFailed, companionCatalog, fallbackAtlasUrl]
  );
  const atlasUrl = activeCompanion.atlasUrl;
  const animationIntent = useMemo(
    () => resolvePartnerIntent(partnerState, physicalState, {
      queued: queuedAnimations,
      capabilities: activeCompanion.capabilities,
      physicalContext: {
        horizontalDirection: dragDirection
      }
    }),
    [partnerState, physicalState, queuedAnimations, activeCompanion.capabilities, dragDirection]
  );
  const stateDisplay = partnerStateDisplay(partnerState);

  useEffect(() => {
    setQueuedAnimations((current) =>
      queuedAnimationsEqual(current, animationIntent.queued) ? current : animationIntent.queued
    );
  }, [animationIntent.queued]);

  useEffect(() => {
    let shortcutCleanup: (() => void) | undefined;
    let restoreCleanup: (() => void) | undefined;

    function clearClickThroughState() {
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      setClickThrough(false);
    }

    applyM0WindowDefaults().catch(() => undefined);
    getSpikeStatus().then(setStatus).catch(() => undefined);
    registerClickThroughRecovery(clearClickThroughState)
      .then((registration) => {
        shortcutCleanup = registration.cleanup;
        setRecoveryStatus(
          registration.shortcuts.length > 0
            ? "key"
            : "auto"
        );
      })
      .catch(() => setRecoveryStatus("auto"));
    listenClickThroughRestored(clearClickThroughState)
      .then((unlisten) => {
        restoreCleanup = unlisten;
      })
      .catch(() => undefined);

    return () => {
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
      }
      shortcutCleanup?.();
      restoreCleanup?.();
    };
  }, []);

  useEffect(() => clearPhysicalTimers, []);

  useEffect(() => {
    let disposed = false;
    listLocalCompanions()
      .then((catalog) => {
        if (disposed) {
          return;
        }
        setCompanionCatalog(catalog);
        setCompanionStatus(catalog.fallbackUsed ? "fallback" : "ready");
        setAtlasFailed(false);
      })
      .catch(() => {
        if (!disposed) {
          setCompanionStatus("fail");
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const startupRevision = stateRevisionRef.current;

    void (async () => {
      try {
        const unlisten = await listenPartnerStateChanged((snapshot) => {
          if (!disposed) {
            stateRevisionRef.current += 1;
            setPartnerState(snapshot);
            setStateCommandStatus("evt");
          }
        });
        if (disposed) {
          unlisten();
        } else {
          cleanup = unlisten;
        }
      } catch {
        // Startup snapshot still gives the renderer a usable baseline.
      }

      try {
        const snapshot = await getCurrentState();
        if (!disposed && stateRevisionRef.current === startupRevision) {
          stateRevisionRef.current += 1;
          setPartnerState(snapshot);
          setStateCommandStatus("snap");
        }
      } catch {
        // Keep the local idle fallback if Tauri is not ready yet.
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrameIndex((value) => (value + 1) % 8);
    }, 180);

    return () => window.clearInterval(timer);
  }, []);

  async function beginManagedDrag(event: React.PointerEvent<HTMLDivElement>) {
    const attempt = dragAttemptRef.current + 1;
    dragAttemptRef.current = attempt;
    event.currentTarget.setPointerCapture(event.pointerId);
    try {
      const [position, cursor] = await Promise.all([
        currentWindowPosition(),
        currentCursorPosition()
      ]);
      if (dragAttemptRef.current !== attempt) {
        return;
      }

      dragRef.current = {
        windowStartX: position.x,
        windowStartY: position.y,
        cursorStartX: cursor.x,
        cursorStartY: cursor.y,
        latestX: position.x,
        latestY: position.y,
        raf: null
      };
      updateDragDirection(undefined);
      clearPhysicalTimers();
      dispatchPhysical({ type: "drag_start" });
      schedulePhysicalEvent("struggle", { type: "struggle" }, 450);
    } catch {
      dragAttemptRef.current += 1;
      resetManagedDrag("abnormal");
    }
  }

  function updateManagedDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const activeDrag = drag;

    if (activeDrag.raf === null) {
      activeDrag.raf = window.requestAnimationFrame(async () => {
        const active = dragRef.current;
        if (!active) {
          return;
        }
        active.raf = null;
        const cursor = await currentCursorPosition();
        if (dragRef.current !== active) {
          return;
        }
        const nextX = active.windowStartX + cursor.x - active.cursorStartX;
        const nextY = active.windowStartY + cursor.y - active.cursorStartY;
        const deltaX = nextX - active.latestX;
        active.latestX = nextX;
        active.latestY = nextY;
        if (Math.abs(deltaX) >= DRAG_DIRECTION_THRESHOLD_PX) {
          updateDragDirection(deltaX > 0 ? "right" : "left");
        }
        moveWindowTo(active.latestX, active.latestY).catch(() => undefined);
      });
    }
  }

  function finishManagedDrag() {
    const drag = dragRef.current;
    if (drag && drag.raf !== null) {
      window.cancelAnimationFrame(drag.raf);
    }
    dragAttemptRef.current += 1;
    dragRef.current = null;
    updateDragDirection(undefined);
    clearPhysicalTimer("struggle");
    if (!drag) {
      dispatchPhysical({ type: "reset", reason: "lost_capture" });
      return;
    }
    dispatchPhysical({ type: "drag_end" });
    schedulePhysicalEvent("land", { type: "land" }, 120);
    schedulePhysicalEvent("recover", { type: "recover" }, 340);
  }

  function resetManagedDrag(reason: "pointer_cancel" | "lost_capture" | "abnormal") {
    const drag = dragRef.current;
    if (drag && drag.raf !== null) {
      window.cancelAnimationFrame(drag.raf);
    }
    dragAttemptRef.current += 1;
    dragRef.current = null;
    updateDragDirection(undefined);
    clearPhysicalTimers();
    dispatchPhysical({ type: "reset", reason });
  }

  function updateDragDirection(direction: PhysicalHorizontalDirection | undefined) {
    if (dragDirectionRef.current === direction) {
      return;
    }
    dragDirectionRef.current = direction;
    setDragDirection(direction);
  }

  function resetLostCaptureIfDragging() {
    if (dragRef.current) {
      resetManagedDrag("lost_capture");
    }
  }

  function schedulePhysicalEvent(
    name: PhysicalTimerName,
    event: PhysicalMachineEvent,
    delayMs: number
  ) {
    clearPhysicalTimer(name);
    physicalTimersRef.current[name] = window.setTimeout(() => {
      physicalTimersRef.current[name] = null;
      dispatchPhysical(event);
    }, delayMs);
  }

  function clearPhysicalTimer(name: PhysicalTimerName) {
    const timer = physicalTimersRef.current[name];
    if (timer !== null) {
      window.clearTimeout(timer);
      physicalTimersRef.current[name] = null;
    }
  }

  function clearPhysicalTimers() {
    clearPhysicalTimer("struggle");
    clearPhysicalTimer("land");
    clearPhysicalTimer("recover");
  }

  async function toggleClickThrough() {
    if (recoveryTimerRef.current !== null) {
      return;
    }

    setClickThrough(true);
    setRecoveryStatus("6s");
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null;
      leaveClickThrough()
        .then(() => setClickThrough(false))
        .catch(() => setRecoveryStatus("fail"));
      }, 6000);

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      });
      await enterClickThrough();
    } catch {
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      setClickThrough(false);
      setRecoveryStatus("fail");
    }
  }

  async function applyStateCommand(command: () => Promise<StateCommandResult>) {
    try {
      const result = await command();
      stateRevisionRef.current += 1;
      setPartnerState(result.snapshot);
      setStateCommandStatus(
        result.usedFallback
          ? "fb"
          : "ok"
      );
    } catch {
      setStateCommandStatus("fail");
    }
  }

  async function switchCompanion(companion: LocalCompanion) {
    if (!canSwitchCompanion(companion, activeCompanion.id)) {
      return;
    }

    setCompanionStatus("set");
    try {
      const catalog = await setSelectedCompanion(companion.id);
      setCompanionCatalog(catalog);
      setQueuedAnimations([]);
      setFrameIndex(0);
      setAtlasFailed(false);
      setCompanionStatus(catalog.fallbackUsed ? "fallback" : "ready");
      setSelectorOpen(false);
    } catch {
      setCompanionStatus("fail");
    }
  }

  function fallBackFromAtlasError() {
    setAtlasFailed(true);
    setQueuedAnimations([]);
    setFrameIndex(0);
    setCompanionStatus("fallback");
  }

  return (
    <main className="window-spike">
      <section className="companion-zone" aria-label="M0 window spike">
        <PartnerRenderer
          intent={animationIntent}
          frameIndex={frameIndex}
          atlasUrl={atlasUrl}
          onAtlasError={fallBackFromAtlasError}
          dragging={dragging}
          onPointerDown={(event) => void beginManagedDrag(event)}
          onPointerMove={updateManagedDrag}
          onPointerUp={finishManagedDrag}
          onPointerCancel={() => resetManagedDrag("pointer_cancel")}
          onLostPointerCapture={resetLostCaptureIfDragging}
        />
      </section>

      <aside className="spike-panel">
        <div className="panel-header">
          <ShieldCheck size={18} aria-hidden />
          <span>M0</span>
        </div>

        <div className="companion-card" aria-label="companion selector">
          <button
            className="companion-trigger"
            type="button"
            aria-expanded={selectorOpen}
            onClick={() => setSelectorOpen((value) => !value)}
          >
            <UserRound size={16} aria-hidden />
            <span>{activeCompanion.name}</span>
            <strong>{activeCompanion.fallbackUsed || atlasFailed ? "fallback" : companionStatus}</strong>
          </button>
          {selectorOpen ? (
            <div className="companion-popover" role="listbox">
              {(companionCatalog?.companions ?? []).map((companion) => {
                const selected = companion.id === activeCompanion.id;
                return (
                  <button
                    key={companion.id}
                    className={`companion-option ${selected ? "is-selected" : ""}`}
                    type="button"
                    disabled={!canSwitchCompanion(companion, activeCompanion.id)}
                    onClick={() => void switchCompanion(companion)}
                  >
                    {companion.valid ? (
                      <CheckCircle2 size={14} aria-hidden />
                    ) : (
                      <XCircle size={14} aria-hidden />
                    )}
                    <span>{companion.displayName}</span>
                    <strong>{selected ? "current" : companion.status}</strong>
                  </button>
                );
              })}
              {companionCatalog && companionCatalog.companions.length === 0 ? (
                <div className="companion-empty">No local pets</div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="check-grid">
          {checks.map(([key, label]) => (
            <div className="check" key={key}>
              <span>{label}</span>
              <strong>{statusText(status, key)}</strong>
            </div>
          ))}
        </div>

        <div className="toolbar" aria-label="window controls">
          <button
            className="icon-button"
            title="恢复默认窗口策略"
            type="button"
            onClick={() => void applyM0WindowDefaults()}
          >
            <Focus size={18} aria-hidden />
          </button>
          <button
            className="icon-button"
            title="进入点击穿透"
            aria-label="进入点击穿透"
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              void toggleClickThrough();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              void toggleClickThrough();
            }}
            onClick={() => void toggleClickThrough()}
          >
            <MousePointer2 size={18} aria-hidden />
          </button>
          <button
            className="icon-button"
            title="刷新 spike 状态"
            type="button"
            onClick={() => void getSpikeStatus().then(setStatus)}
          >
            <ScanLine size={18} aria-hidden />
          </button>
          <button
            className="icon-button"
            title="切换 sprite 探针帧"
            type="button"
            onClick={() => setFrameIndex((value) => (value + 1) % 8)}
          >
            <Layers2 size={18} aria-hidden />
          </button>
        </div>

        <div className="state-card" aria-label="workflow state">
          <div className="state-row">
            <span>workflow</span>
            <strong>{stateDisplay.workflowLabel}</strong>
            <span>source</span>
            <strong>{stateDisplay.sourceLabel}</strong>
          </div>
          <div className="state-row state-row-wide">
            <span>message</span>
            <strong>{stateDisplay.message}</strong>
          </div>
          <div className="state-row">
            <span>paused</span>
            <strong>{stateDisplay.pausedLabel}</strong>
            <span>connection</span>
            <strong>{stateDisplay.connectionLabel}</strong>
          </div>
        </div>

        <div className="toolbar state-toolbar" aria-label="state controls">
          <button
            className="icon-button"
            title="暂停 workflow 状态推送"
            type="button"
            disabled={!stateDisplay.canPause}
            onClick={() => void applyStateCommand(pausePartner)}
          >
            <CirclePause size={18} aria-hidden />
          </button>
          <button
            className="icon-button"
            title="恢复 workflow 状态推送"
            type="button"
            disabled={!stateDisplay.canResume}
            onClick={() => void applyStateCommand(resumePartner)}
          >
            <CirclePlay size={18} aria-hidden />
          </button>
          <button
            className="icon-button"
            title="清除错误状态"
            type="button"
            disabled={!stateDisplay.canClearError}
            onClick={() => void applyStateCommand(clearPartnerError)}
          >
            <CircleX size={18} aria-hidden />
          </button>
        </div>

        {clickThrough ? (
          <div className="click-through-banner" role="status">
            <span>穿透中</span>
            <strong>6s auto restore</strong>
          </div>
        ) : (
          <div className="runtime-strip">
            <Move size={14} aria-hidden />
            <span>{dragging ? "drg" : "spr"}</span>
            <ArrowDownToLine size={14} aria-hidden />
            <span>{runtimeRunStatus(stateDisplay.runLabel)}</span>
            <span>{stateCommandStatus}</span>
            <span>{recoveryStatus}</span>
          </div>
        )}
      </aside>
    </main>
  );
}
