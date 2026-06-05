import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  CLICK_THROUGH_RECOVERY_SHORTCUT,
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
  petdexRowForIntent,
  resolvePartnerIntent
} from "./animationIntentView";
import { buildProbeAtlasDataUrl, spriteFrame } from "./spriteProbe";
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

export function App() {
  const [status, setStatus] = useState<SpikeStatus | null>(null);
  const [clickThrough, setClickThrough] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState(CLICK_THROUGH_RECOVERY_SHORTCUT);
  const [partnerState, setPartnerState] = useState(idlePartnerState);
  const [stateCommandStatus, setStateCommandStatus] = useState("state controls ready");
  const recoveryTimerRef = useRef<number | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const stateRevisionRef = useRef(0);
  const probeAtlas = useMemo(() => buildProbeAtlasDataUrl(), []);
  const animationIntent = useMemo(
    () => resolvePartnerIntent(partnerState, dragging ? "carried" : "normal"),
    [dragging, partnerState]
  );
  const frame = spriteFrame(petdexRowForIntent(animationIntent), frameIndex);
  const stateDisplay = partnerStateDisplay(partnerState);

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
            ? `shortcut: ${registration.shortcuts.join(" / ")}`
            : `auto restore only (${registration.errors[0] ?? "shortcut unavailable"})`
        );
      })
      .catch((error) => setRecoveryStatus(`auto restore only (${String(error)})`));
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
            setStateCommandStatus("state event received");
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
          setStateCommandStatus("startup snapshot loaded");
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
    event.currentTarget.setPointerCapture(event.pointerId);
    const [position, cursor] = await Promise.all([
      currentWindowPosition(),
      currentCursorPosition()
    ]);

    dragRef.current = {
      windowStartX: position.x,
      windowStartY: position.y,
      cursorStartX: cursor.x,
      cursorStartY: cursor.y,
      latestX: position.x,
      latestY: position.y,
      raf: null
    };
    setDragging(true);
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

  function endManagedDrag() {
    const drag = dragRef.current;
    if (drag && drag.raf !== null) {
      window.cancelAnimationFrame(drag.raf);
    }
    dragRef.current = null;
    setDragging(false);
  }

  async function toggleClickThrough() {
    if (recoveryTimerRef.current !== null) {
      return;
    }

    setClickThrough(true);
    setRecoveryStatus((value) => `${value}; auto in 6s`);
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null;
      leaveClickThrough()
        .then(() => setClickThrough(false))
        .catch(() => setRecoveryStatus("auto restore failed"));
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
      setRecoveryStatus("click-through failed");
    }
  }

  async function applyStateCommand(command: () => Promise<StateCommandResult>) {
    try {
      const result = await command();
      stateRevisionRef.current += 1;
      setPartnerState(result.snapshot);
      setStateCommandStatus(
        result.usedFallback
          ? `command fallback: ${result.error ?? "unknown error"}`
          : "command applied"
      );
    } catch (error) {
      setStateCommandStatus(`command failed: ${String(error)}`);
    }
  }

  return (
    <main className="window-spike">
      <section className="companion-zone" aria-label="M0 window spike">
        <div className="bubble">
          <span>{stateDisplay.workflowLabel}</span>
          <strong>{stateDisplay.message}</strong>
        </div>

        <div
          className={`partner ${dragging ? "is-dragging" : ""}`}
          onPointerDown={(event) => void beginManagedDrag(event)}
          onPointerMove={updateManagedDrag}
          onPointerUp={endManagedDrag}
          onPointerCancel={endManagedDrag}
        >
          <div
            className="sprite-frame"
            style={{
              width: frame.width,
              height: frame.height,
              backgroundImage: `url("${probeAtlas}")`,
              backgroundSize: frame.backgroundSize,
              backgroundPosition: frame.backgroundPosition
            }}
          />
        </div>
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

        <div className="runtime-strip">
          <Move size={14} aria-hidden />
          <span>{dragging ? "managed drag" : "sprite probe"}</span>
          <ArrowDownToLine size={14} aria-hidden />
          <span>{stateDisplay.runLabel}</span>
          <span>{stateCommandStatus}</span>
          <span>{recoveryStatus}</span>
        </div>

        {clickThrough ? (
          <div className="click-through-banner">
            <span>穿透中</span>
            <strong>6s auto restore</strong>
          </div>
        ) : null}
      </aside>
    </main>
  );
}
