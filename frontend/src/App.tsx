import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
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
  currentCursorPosition,
  currentWindowPosition,
  enterClickThrough,
  getSpikeStatus,
  leaveClickThrough,
  moveWindowTo,
  registerClickThroughRecovery,
  type SpikeStatus
} from "./tauriWindow";
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
    "global shortcut": "shortcut"
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
  const recoveryTimerRef = useRef<number | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const probeAtlas = useMemo(() => buildProbeAtlasDataUrl(), []);
  const frame = spriteFrame("review", frameIndex);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    function recoverClickThrough() {
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      setClickThrough(false);
    }

    applyM0WindowDefaults().catch(() => undefined);
    getSpikeStatus().then(setStatus).catch(() => undefined);
    registerClickThroughRecovery(recoverClickThrough)
      .then((registration) => {
        cleanup = registration.cleanup;
        setRecoveryStatus(
          registration.shortcuts.length > 0
            ? `shortcut: ${registration.shortcuts.join(" / ")}`
            : `auto restore only (${registration.errors[0] ?? "shortcut unavailable"})`
        );
      })
      .catch((error) => setRecoveryStatus(`auto restore only (${String(error)})`));

    return () => {
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
      }
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
    try {
      await enterClickThrough();
      setClickThrough(true);
      setRecoveryStatus((value) => `${value}; auto in 6s`);
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
      }
      recoveryTimerRef.current = window.setTimeout(() => {
        recoveryTimerRef.current = null;
        leaveClickThrough()
          .then(() => setClickThrough(false))
          .catch(() => setRecoveryStatus("auto restore failed"));
      }, 6000);
    } catch {
      setRecoveryStatus("click-through failed");
    }
  }

  return (
    <main className="window-spike">
      <section className="companion-zone" aria-label="M0 window spike">
        <div className="bubble">
          <span>reading</span>
          <strong>正在读取项目内容</strong>
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
            type="button"
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

        <div className="runtime-strip">
          <Move size={14} aria-hidden />
          <span>{dragging ? "managed drag" : "sprite probe"}</span>
          <ArrowDownToLine size={14} aria-hidden />
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
