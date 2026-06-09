import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowDownToLine,
  CirclePause,
  CirclePlay,
  CircleX,
  Focus,
  Layers2,
  MousePointer2,
  Move,
  ScanLine,
  ShieldCheck
} from "lucide-react";
import { type AnimationIntent } from "@ai-partner/contracts";
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
  moveWindowTo,
  pausePartner,
  registerClickThroughRecovery,
  resumePartner,
  type StateCommandResult,
  type SpikeStatus
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
import { buildProbeAtlasDataUrl } from "./spriteProbe";
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
  const [physicalMachine, dispatchPhysical] = useReducer(
    physicalStateMachine,
    initialPhysicalMachineState
  );
  const dragRef = useRef<DragState | null>(null);
  const dragAttemptRef = useRef(0);
  const physicalTimersRef = useRef<Record<PhysicalTimerName, number | null>>({
    struggle: null,
    land: null,
    recover: null
  });
  const stateRevisionRef = useRef(0);
  const probeAtlas = useMemo(() => buildProbeAtlasDataUrl(), []);
  const physicalState = physicalMachine.state;
  const dragging = physicalState === "carried" || physicalState === "struggling";
  const animationIntent = useMemo(
    () => resolvePartnerIntent(partnerState, physicalState, {
      queued: queuedAnimations
    }),
    [partnerState, physicalState, queuedAnimations]
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
        active.latestX = active.windowStartX + cursor.x - active.cursorStartX;
        active.latestY = active.windowStartY + cursor.y - active.cursorStartY;
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
    clearPhysicalTimers();
    dispatchPhysical({ type: "reset", reason });
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

  return (
    <main className="window-spike">
      <section className="companion-zone" aria-label="M0 window spike">
        <PartnerRenderer
          intent={animationIntent}
          frameIndex={frameIndex}
          atlasUrl={probeAtlas}
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
