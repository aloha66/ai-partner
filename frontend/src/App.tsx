import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Bug,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  CircleX,
  FolderOpen,
  Focus,
  Layers2,
  MousePointer2,
  Move,
  Palette,
  Power,
  Search,
  ScanLine,
  ShieldCheck,
  Sparkles,
  LoaderCircle,
  SunMoon,
  UserRound,
  X,
  XCircle
} from "lucide-react";
import {
  WORKFLOW_EVENT_SCHEMA_VERSION,
  type AnimationRef,
  type AnimationIntent,
  type WorkflowAuthorization
} from "@ai-partner/contracts";
import { type PhysicalHorizontalDirection } from "@ai-partner/resolver";
import {
  applyM0WindowDefaults,
  applyWorkflowEvent,
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
  openLocalPetsDirectory,
  pausePartner,
  quitApp,
  registerClickThroughRecovery,
  resumePartner,
  setWindowFocusable,
  setSelectedCompanion,
  type StateCommandResult,
  type SpikeStatus,
  type CompanionCatalog,
  type LocalCompanion
} from "./tauriWindow";
import {
  idlePartnerState,
  interactiveCardView,
  localAuthorizationDecisionKey,
  partnerStateDisplay
} from "./partnerStateView";
import { resolveAuthorizationDecision } from "./partnerStateView";
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
  canSwitchCompanion,
  companionSelectorOptions
} from "./companionSelector";
import {
  readStoredTheme,
  resolveTheme,
  storeTheme,
  themeLabel,
  type ThemePreference
} from "./theme";
import { resolveDebugMode } from "./debugMode";
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
type MenuPosition = {
  x: number;
  y: number;
};

const CONTEXT_MENU_WIDTH_PX = 206;
const CONTEXT_MENU_MAX_HEIGHT_PX = 330;
const CONTEXT_MENU_MARGIN_PX = 10;
const DRAG_DIRECTION_THRESHOLD_PX = 1;
const selectorInputId = "companion-selector-search";

const debugMode = resolveDebugMode({
  dev: import.meta.env.DEV,
  mode: import.meta.env.MODE,
  viteDebug: import.meta.env.VITE_AI_PARTNER_DEBUG,
  appDebug: import.meta.env.VITE_AI_PARTNER_APP_DEBUG
});

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

function readInitialThemePreference(): ThemePreference {
  try {
    return readStoredTheme(window.localStorage);
  } catch {
    return "system";
  }
}

function debugPreviewPartnerState() {
  if (debugMode !== "visible") {
    return null;
  }

  const card = new URLSearchParams(window.location.search).get("card");
  if (card === "auth") {
    return {
      ...idlePartnerState,
      workflowState: "waiting" as const,
      runId: "run_preview_auth",
      activeRunId: "run_preview_auth",
      source: "claude-hook" as const,
      message: "需要授权执行命令",
      cardTitle: "Command approval preview",
      contextPath: "/Users/aloha66/code/ai-partner",
      authorization: {
        kind: "command" as const,
        id: "auth_preview_command",
        title: "Command approval preview",
        description: "pnpm test",
        status: "pending" as const
      },
      updatedAt: new Date().toISOString(),
      connection: "ok" as const
    };
  }

  if (card === "running") {
    return {
      ...idlePartnerState,
      workflowState: "running" as const,
      runId: "run_preview_running",
      activeRunId: "run_preview_running",
      source: "codex-wrapper" as const,
      message: "正在执行 pnpm test",
      cardTitle: "Running command",
      contextPath: "/Users/aloha66/code/ai-partner",
      updatedAt: new Date().toISOString(),
      connection: "ok" as const
    };
  }

  return null;
}

function decisionEventId(authorizationId: string, choice: "allow" | "deny", decidedAt: string): string {
  const authSegment = authorizationId.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 58);
  const timeSegment = Date.parse(decidedAt).toString(36);
  return `evt_${authSegment}_${choice}_${timeSegment}`;
}

function contextMenuPosition(clientX: number, clientY: number): MenuPosition {
  const viewportWidth = Math.max(window.innerWidth, CONTEXT_MENU_WIDTH_PX + CONTEXT_MENU_MARGIN_PX * 2);
  const viewportHeight = Math.max(window.innerHeight, CONTEXT_MENU_MAX_HEIGHT_PX + CONTEXT_MENU_MARGIN_PX * 2);
  return {
    x: Math.min(
      Math.max(clientX, CONTEXT_MENU_MARGIN_PX),
      viewportWidth - CONTEXT_MENU_WIDTH_PX - CONTEXT_MENU_MARGIN_PX
    ),
    y: Math.min(
      Math.max(clientY, CONTEXT_MENU_MARGIN_PX),
      viewportHeight - CONTEXT_MENU_MAX_HEIGHT_PX - CONTEXT_MENU_MARGIN_PX
    )
  };
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
  const [partnerState, setPartnerState] = useState(() => debugPreviewPartnerState() ?? idlePartnerState);
  const [localAuthorizationDecisions, setLocalAuthorizationDecisions] = useState<
    Record<string, WorkflowAuthorization>
  >({});
  const [stateCommandStatus, setStateCommandStatus] = useState("ok");
  const [queuedAnimations, setQueuedAnimations] = useState<AnimationIntent["queued"]>([]);
  const recoveryTimerRef = useRef<number | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const fallbackAtlasUrl = useMemo(() => defaultAtlasUrl(), []);
  const [companionCatalog, setCompanionCatalog] = useState<CompanionCatalog | null>(null);
  const [companionStatus, setCompanionStatus] = useState("scan");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorQuery, setSelectorQuery] = useState("");
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ x: 10, y: 10 });
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readInitialThemePreference);
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const [atlasFailed, setAtlasFailed] = useState(false);
  const [failedFrameSequenceAnimations, setFailedFrameSequenceAnimations] = useState<AnimationRef[]>([]);
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
  const debugPanelVisible = debugMode === "visible" && debugPanelOpen;
  const resolvedTheme = resolveTheme(themePreference, systemDark);
  const activeCompanion = useMemo(
    () => activeCompanionView(atlasFailed ? null : companionCatalog, fallbackAtlasUrl),
    [atlasFailed, companionCatalog, fallbackAtlasUrl]
  );
  const effectiveCapabilities = useMemo(() => {
    if (failedFrameSequenceAnimations.length === 0) {
      return activeCompanion.capabilities;
    }
    const animations = { ...activeCompanion.capabilities.animations };
    for (const animation of failedFrameSequenceAnimations) {
      delete animations[animation];
    }
    return {
      ...activeCompanion.capabilities,
      animations
    };
  }, [activeCompanion.capabilities, failedFrameSequenceAnimations]);
  const atlasUrl = activeCompanion.atlasUrl;
  const animationIntent = useMemo(
    () => resolvePartnerIntent(partnerState, physicalState, {
      queued: queuedAnimations,
      capabilities: effectiveCapabilities,
      physicalContext: {
        horizontalDirection: dragDirection
      }
    }),
    [partnerState, physicalState, queuedAnimations, effectiveCapabilities, dragDirection]
  );
  const stateDisplay = partnerStateDisplay(partnerState);
  const displayedPartnerState = useMemo(() => {
    const authorization = partnerState.authorization;
    if (!authorization) {
      return partnerState;
    }
    const localDecision = localAuthorizationDecisions[localAuthorizationDecisionKey(partnerState)];
    if (!localDecision) {
      return partnerState;
    }
    return {
      ...partnerState,
      authorization: localDecision
    };
  }, [localAuthorizationDecisions, partnerState]);
  const interactionCard = interactiveCardView(displayedPartnerState);
  // Agent stays in the header badge; metadata cells are reserved for workspace context.
  const interactionContextMeta = interactionCard.meta.filter((item) => item.label !== "Agent");
  const actionableInteractionCard = interactionCard.action?.status === "pending";
  const selectorOptions = useMemo(
    () => companionSelectorOptions(companionCatalog, activeCompanion.id, selectorQuery),
    [companionCatalog, activeCompanion.id, selectorQuery]
  );

  useEffect(() => {
    setQueuedAnimations((current) =>
      queuedAnimationsEqual(current, animationIntent.queued) ? current : animationIntent.queued
    );
  }, [animationIntent.queued]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = themePreference;
    storeTheme(window.localStorage, themePreference);
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    if (selectorOpen) {
      let active = true;
      setWindowFocusable(true)
        .catch(() => undefined)
        .finally(() => {
          window.requestAnimationFrame(() => {
            if (active) {
              document.getElementById(selectorInputId)?.focus();
            }
          });
        });
      return () => {
        active = false;
        setWindowFocusable(false).catch(() => undefined);
      };
    }
    setSelectorQuery("");
    setWindowFocusable(false).catch(() => undefined);
    return undefined;
  }, [selectorOpen]);

  useEffect(() => {
    if (selectorOpen) {
      return undefined;
    }
    if (actionableInteractionCard) {
      setWindowFocusable(true).catch(() => undefined);
      return () => {
        setWindowFocusable(false).catch(() => undefined);
      };
    }
    setWindowFocusable(false).catch(() => undefined);
    return undefined;
  }, [actionableInteractionCard, selectorOpen]);

  useEffect(() => {
    if (!selectorOpen && !contextMenuOpen) {
      return undefined;
    }

    function closeTransientUi(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectorOpen(false);
        setContextMenuOpen(false);
      }
    }

    window.addEventListener("keydown", closeTransientUi);
    return () => window.removeEventListener("keydown", closeTransientUi);
  }, [selectorOpen, contextMenuOpen]);

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
        setFailedFrameSequenceAnimations([]);
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
      if (debugPreviewPartnerState()) {
        return;
      }

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
    if (event.button !== 0) {
      return;
    }

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
      setFailedFrameSequenceAnimations([]);
      setCompanionStatus(catalog.fallbackUsed ? "fallback" : "ready");
      setSelectorOpen(false);
    } catch {
      setCompanionStatus("fail");
    }
  }

  function fallBackFromAtlasError() {
    setAtlasFailed(true);
    setFailedFrameSequenceAnimations([]);
    setQueuedAnimations([]);
    setFrameIndex(0);
    setCompanionStatus("fallback");
  }

  function fallBackFromFrameSequenceError(animation: AnimationRef) {
    setFailedFrameSequenceAnimations((current) =>
      current.includes(animation) ? current : [...current, animation]
    );
    setQueuedAnimations([]);
    setFrameIndex(0);
  }

  async function decideAuthorization(choice: "allow" | "deny") {
    const authorization = displayedPartnerState.authorization;
    if (!authorization || authorization.status !== "pending") {
      return;
    }

    const decidedAt = new Date();
    const decision = resolveAuthorizationDecision(authorization, choice, decidedAt);
    const decisionKey = localAuthorizationDecisionKey(displayedPartnerState);

    const runId = displayedPartnerState.activeRunId ?? displayedPartnerState.runId;
    if (!runId || displayedPartnerState.source === null) {
      setLocalAuthorizationDecisions((current) => ({
        ...current,
        [decisionKey]: decision
      }));
      return;
    }

    try {
      const snapshot = await applyWorkflowEvent({
        schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
        event_id: decisionEventId(authorization.id, choice, decision.decidedAt ?? decidedAt.toISOString()),
        source: displayedPartnerState.source,
        run_id: runId,
        workflow_state: displayedPartnerState.workflowState,
        timestamp: decision.decidedAt ?? decidedAt.toISOString(),
        ...(displayedPartnerState.message === undefined ? {} : { message: displayedPartnerState.message }),
        ...(displayedPartnerState.cardTitle === undefined ? {} : { card_title: displayedPartnerState.cardTitle }),
        ...(displayedPartnerState.contextPath === undefined ? {} : { context_path: displayedPartnerState.contextPath }),
        authorization: decision,
        code_context_allowed: false
      });
      stateRevisionRef.current += 1;
      setPartnerState(snapshot);
      setLocalAuthorizationDecisions((current) => ({
        ...current,
        [decisionKey]: decision
      }));
      setStateCommandStatus("ok");
    } catch {
      setStateCommandStatus("fail");
    }
  }

  function openContextMenu(event: React.MouseEvent<HTMLElement>) {
    if (event.target === event.currentTarget) {
      closeContextMenu();
      return;
    }

    event.preventDefault();
    setMenuPosition(contextMenuPosition(event.clientX, event.clientY));
    setContextMenuOpen(true);
  }

  function closeContextMenu() {
    setContextMenuOpen(false);
  }

  function openSelector() {
    setSelectorOpen(true);
    closeContextMenu();
  }

  function closeSelector() {
    setSelectorOpen(false);
  }

  async function togglePauseFromMenu() {
    closeContextMenu();
    await applyStateCommand(stateDisplay.canResume ? resumePartner : pausePartner);
  }

  async function openActivePetsDirectory() {
    closeContextMenu();
    const source = activeCompanion.source === "codex" ? "codex" : "petdex";
    await openLocalPetsDirectory(source).catch(() => setCompanionStatus("fail"));
  }

  function chooseTheme(preference: ThemePreference) {
    setThemePreference(preference);
    closeContextMenu();
  }

  return (
    <main
      className={`window-spike theme-${resolvedTheme} ${debugPanelVisible ? "debug-visible" : "debug-hidden"}`}
      data-debug-mode={debugMode}
      data-theme-preference={themePreference}
      onPointerDown={(event) => {
        if (event.button === 0 && contextMenuOpen) {
          closeContextMenu();
        }
      }}
    >
      <section
        className={`companion-zone ${interactionCard.visible ? "has-interaction-card" : ""}`}
        aria-label="M0 window spike"
        onContextMenu={openContextMenu}
      >
        {interactionCard.visible ? (
          <section
            className={`interaction-card is-${interactionCard.variant} tone-${interactionCard.tone}`}
            aria-label="workflow interaction card"
            aria-live="polite"
          >
            <header className="interaction-card-header">
              <span className="state-indicator" aria-hidden>
                {interactionCard.tone === "active" || interactionCard.tone === "attention" ? (
                  <LoaderCircle size={14} />
                ) : null}
              </span>
              <div>
                <h2>{interactionCard.title}</h2>
                <p>{interactionCard.statusText}</p>
              </div>
              <strong className="agent-badge">{interactionCard.sourceLabel}</strong>
            </header>
            <div className="interaction-meta" aria-label="workflow context details">
              {interactionContextMeta.map((item) => (
                <span key={item.label} title={item.title ?? item.value}>
                  <b>{item.label}</b>
                  <strong>{item.value}</strong>
                </span>
              ))}
            </div>
            {interactionCard.action ? (
              <div className="interaction-actions">
                {interactionCard.action.status === "pending" ? (
                  <>
                    <button
                      className="decision-button deny"
                      type="button"
                      onClick={() => void decideAuthorization("deny")}
                    >
                      {interactionCard.action.denyLabel}
                    </button>
                    <button
                      className="decision-button allow"
                      type="button"
                      onClick={() => void decideAuthorization("allow")}
                    >
                      {interactionCard.action.allowLabel}
                    </button>
                  </>
                ) : (
                  <div className={`decision-result ${interactionCard.action.status}`}>
                    {interactionCard.action.status === "allowed" ? "Allowed" : "Denied"}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        <PartnerRenderer
          intent={animationIntent}
          frameIndex={frameIndex}
          atlasUrl={atlasUrl}
          onAtlasError={fallBackFromAtlasError}
          onFrameSequenceError={fallBackFromFrameSequenceError}
          dragging={dragging}
          onPointerDown={(event) => void beginManagedDrag(event)}
          onPointerMove={updateManagedDrag}
          onPointerUp={finishManagedDrag}
          onPointerCancel={() => resetManagedDrag("pointer_cancel")}
          onLostPointerCapture={resetLostCaptureIfDragging}
        />

        <div className="status-pill" role="status" aria-live="polite">
          <span>{stateDisplay.pausedLabel}</span>
          <strong>{activeCompanion.fallbackUsed || atlasFailed || failedFrameSequenceAnimations.length > 0 ? "fallback" : stateDisplay.workflowLabel}</strong>
        </div>
      </section>

      {contextMenuOpen ? (
        <div
          className="companion-menu"
          role="menu"
          aria-label="companion menu"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button className="menu-item" type="button" role="menuitem" onClick={openSelector}>
            <Sparkles size={16} aria-hidden />
            <span>切换伴侣...</span>
          </button>
          <button className="menu-item" type="button" role="menuitem" onClick={() => void togglePauseFromMenu()}>
            {stateDisplay.canResume ? (
              <CirclePlay size={16} aria-hidden />
            ) : (
              <CirclePause size={16} aria-hidden />
            )}
            <span>{stateDisplay.canResume ? "恢复状态" : "暂停状态"}</span>
          </button>
          <button
            className="menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              closeContextMenu();
              void toggleClickThrough();
            }}
          >
            <MousePointer2 size={16} aria-hidden />
            <span>点击穿透 6s</span>
          </button>
          <button className="menu-item" type="button" role="menuitem" onClick={() => void openActivePetsDirectory()}>
            <FolderOpen size={16} aria-hidden />
            <span>打开本地 pets 目录</span>
          </button>
          <div className="menu-group" role="group" aria-label="外观">
            <div className="menu-group-label">
              <Palette size={15} aria-hidden />
              <span>外观</span>
            </div>
            {(["system", "light", "dark"] as const).map((preference) => (
              <button
                key={preference}
                className={`theme-choice ${themePreference === preference ? "is-selected" : ""}`}
                type="button"
                onClick={() => chooseTheme(preference)}
              >
                <SunMoon size={14} aria-hidden />
                <span>{themeLabel(preference)}</span>
              </button>
            ))}
          </div>
          {debugMode === "visible" ? (
            <button
              className="menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setDebugPanelOpen((value) => !value);
                closeContextMenu();
              }}
            >
              <Bug size={16} aria-hidden />
              <span>诊断信息</span>
            </button>
          ) : null}
          <button className="menu-item danger" type="button" role="menuitem" onClick={() => void quitApp()}>
            <Power size={16} aria-hidden />
            <span>退出</span>
          </button>
        </div>
      ) : null}

      {selectorOpen ? (
        <div className="selector-backdrop" role="presentation" onPointerDown={closeSelector}>
          <section
            className="companion-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="companion-selector-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <div>
                <p>Local companions</p>
                <h1 id="companion-selector-title">切换伴侣</h1>
              </div>
              <button className="icon-button quiet" type="button" aria-label="关闭选择器" onClick={closeSelector}>
                <X size={17} aria-hidden />
              </button>
            </header>
            <label className="selector-search" htmlFor={selectorInputId}>
              <Search size={15} aria-hidden />
              <input
                id={selectorInputId}
                autoFocus
                value={selectorQuery}
                onChange={(event) => setSelectorQuery(event.target.value)}
                placeholder="搜索本地伴侣"
              />
            </label>
            <div className="selector-list" role="listbox" aria-label="local companions">
              {selectorOptions.map((option) => (
                <button
                  key={option.companion.id}
                  className={`selector-option ${option.selected ? "is-selected" : ""}`}
                  type="button"
                  disabled={!option.switchable}
                  onClick={() => void switchCompanion(option.companion)}
                >
                  {option.companion.valid ? (
                    <CheckCircle2 size={16} aria-hidden />
                  ) : (
                    <XCircle size={16} aria-hidden />
                  )}
                  <span className="selector-option-main">
                    <strong>{option.companion.displayName}</strong>
                    <span>
                      {option.sourceLabel}
                      {option.duplicateName ? " source variant" : ""}
                    </span>
                  </span>
                  <span className="selector-option-status">
                    {option.selected ? "current" : option.companion.valid ? option.companion.status : option.reason}
                  </span>
                </button>
              ))}
              {companionCatalog && companionCatalog.companions.length === 0 ? (
                <div className="selector-empty">
                  No local companions in Petdex or Codex Desktop pets folders.
                </div>
              ) : null}
              {companionCatalog && companionCatalog.companions.length > 0 && selectorOptions.length === 0 ? (
                <div className="selector-empty">
                  No local companions match "{selectorQuery}".
                </div>
              ) : null}
              {!companionCatalog && companionStatus !== "fail" ? (
                <div className="selector-empty">
                  Scanning Petdex and Codex Desktop pets folders.
                </div>
              ) : null}
              {!companionCatalog && companionStatus === "fail" ? (
                <div className="selector-empty">
                  Could not read local companion folders.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {debugPanelVisible ? (
      <aside className="spike-panel">
        <div className="panel-header">
          <ShieldCheck size={18} aria-hidden />
          <span>M0</span>
        </div>

        <div className="companion-card" aria-label="active companion debug summary">
          <div className="companion-trigger">
            <UserRound size={16} aria-hidden />
            <span>{activeCompanion.name}</span>
            <strong>{activeCompanion.fallbackUsed || atlasFailed ? "fallback" : companionStatus}</strong>
          </div>
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
      ) : null}
    </main>
  );
}
