import {
  ANIMATION_INTENT_SCHEMA_VERSION,
  type AnimationFrameSource,
  type AnimationIntent,
  type AnimationRef,
  type BodyAnimationIntent,
  type BubbleIntent,
  type PartnerStateSnapshot,
  type ProceduralEffect,
  type QueuedAnimationIntent,
  type WorkflowState
} from "@ai-partner/contracts";
import {
  type PartnerCapabilities,
  mergeWithDefaultFallbacks
} from "./capabilities";
import { type PhysicalAnimationContext, type PhysicalState } from "./physical";

export interface ResolveAnimationOptions {
  now?: Date;
  queued?: QueuedAnimationIntent[];
  physicalContext?: PhysicalAnimationContext;
}

const DONE_QUEUE_TTL_MS = 5_000;

const defaultBubbleText: Record<WorkflowState, string> = {
  idle: "等待 workflow 事件",
  running: "AI 正在运行",
  reading: "正在读取项目内容",
  editing: "正在编辑",
  waiting: "等待用户输入",
  error: "工作流出错",
  done: "已完成"
};

const physicalTargetByState: Partial<Record<PhysicalState, AnimationRef>> = {
  carried: "physical.carried",
  struggling: "physical.struggling",
  falling: "physical.falling",
  recovering: "physical.recovering"
};

const proceduralByPhysical: Partial<Record<PhysicalState, ProceduralEffect[]>> = {
  carried: ["float"],
  struggling: ["shake"],
  falling: ["drop"],
  recovering: ["squash"]
};

const loopByPhysical: Partial<Record<PhysicalState, boolean>> = {
  carried: true,
  struggling: true,
  falling: false,
  recovering: false
};

export function resolveAnimation(
  snapshot: PartnerStateSnapshot,
  physicalState: PhysicalState,
  capabilities: PartnerCapabilities,
  options: ResolveAnimationOptions = {}
): AnimationIntent {
  const now = options.now ?? new Date();
  const mergedCapabilities = mergeWithDefaultFallbacks(capabilities);
  const activeQueue = activeQueuedAnimations(options.queued ?? [], now);
  const canUseQueuedDone =
    snapshot.workflowState === "idle" || snapshot.workflowState === "done";
  const replayQueued = physicalState === "normal" && canUseQueuedDone ? activeQueue[0] : undefined;
  const workflowTarget = workflowAnimationRef(snapshot.workflowState);
  const physicalTarget = physicalTargetByState[physicalState];

  if (replayQueued) {
    const body = bodyIntentFor(replayQueued.animation, mergedCapabilities, {
      fallbackProcedural: [],
      fallbackLoop: false
    });
    return buildIntent(body, bubbleForSnapshot(snapshot), activeQueue.slice(1));
  }

  const bodyTarget =
    physicalState === "normal" || physicalTarget === undefined ? workflowTarget : physicalTarget;
  const body = bodyIntentFor(bodyTarget, mergedCapabilities, {
    fallbackProcedural: physicalTarget ? proceduralByPhysical[physicalState] ?? [] : [],
    fallbackLoop: physicalTarget ? loopByPhysical[physicalState] ?? true : true,
    physicalContext: options.physicalContext
  });
  const queued =
    snapshot.workflowState === "done" && physicalState !== "normal"
      ? preserveOrQueueDoneAnimation(activeQueue, workflowTarget, mergedCapabilities, now)
      : canUseQueuedDone ? activeQueue : [];

  return buildIntent(body, bubbleForSnapshot(snapshot), queued);
}

function buildIntent(
  body: BodyAnimationIntent,
  bubble: BubbleIntent | null,
  queued: QueuedAnimationIntent[]
): AnimationIntent {
  return {
    schemaVersion: ANIMATION_INTENT_SCHEMA_VERSION,
    body,
    bubble,
    queued
  };
}

function workflowAnimationRef(workflowState: WorkflowState): AnimationRef {
  return `workflow.${workflowState}`;
}

function bubbleForSnapshot(snapshot: PartnerStateSnapshot): BubbleIntent | null {
  if (snapshot.workflowState === "idle") {
    return null;
  }
  return {
    state: snapshot.workflowState,
    text: snapshot.message ?? defaultBubbleText[snapshot.workflowState],
    priority:
      snapshot.workflowState === "waiting" || snapshot.workflowState === "error"
        ? "high"
        : snapshot.priority
  };
}

function bodyIntentFor(
  requested: AnimationRef,
  capabilities: PartnerCapabilities,
  fallback: {
    fallbackProcedural: ProceduralEffect[];
    fallbackLoop: boolean;
    physicalContext?: PhysicalAnimationContext;
  }
): BodyAnimationIntent {
  const animation = selectAnimation(requested, capabilities, fallback.physicalContext);
  const timeline = capabilities.animations[animation];
  const procedural = new Set<ProceduralEffect>([
    ...(timeline?.procedural ?? []),
    ...fallback.fallbackProcedural
  ]);

  return {
    animation,
    procedural: [...procedural],
    loop: timeline?.loop ?? fallback.fallbackLoop,
    source: timeline?.source ?? missingFrameSource()
  };
}

function selectAnimation(
  requested: AnimationRef,
  capabilities: PartnerCapabilities,
  physicalContext?: PhysicalAnimationContext
): AnimationRef {
  if (capabilities.animations[requested]) {
    return requested;
  }
  for (const fallback of orderedFallbacks(
    requested,
    capabilities.fallbacks[requested] ?? [],
    physicalContext
  )) {
    if (capabilities.animations[fallback]) {
      return fallback;
    }
  }
  return requested;
}

function orderedFallbacks(
  requested: AnimationRef,
  fallbacks: AnimationRef[],
  physicalContext?: PhysicalAnimationContext
): AnimationRef[] {
  const direction = physicalContext?.horizontalDirection;
  if (requested !== "physical.struggling" || direction === undefined) {
    return fallbacks;
  }

  const preferred: AnimationRef =
    direction === "right" ? "legacy.running-right" : "legacy.running-left";
  const alternate: AnimationRef =
    direction === "right" ? "legacy.running-left" : "legacy.running-right";
  const firstDirectionalIndex = Math.min(
    indexOrInfinity(fallbacks, "legacy.running-left"),
    indexOrInfinity(fallbacks, "legacy.running-right")
  );

  if (!Number.isFinite(firstDirectionalIndex) || !fallbacks.includes(preferred)) {
    return fallbacks;
  }

  const directional = new Set<AnimationRef>(["legacy.running-left", "legacy.running-right"]);
  return [
    ...fallbacks.slice(0, firstDirectionalIndex).filter((fallback) => !directional.has(fallback)),
    preferred,
    ...(fallbacks.includes(alternate) ? [alternate] : []),
    ...fallbacks.slice(firstDirectionalIndex).filter((fallback) => !directional.has(fallback))
  ];
}

function indexOrInfinity(values: AnimationRef[], value: AnimationRef): number {
  const index = values.indexOf(value);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function queueDoneAnimation(
  workflowDone: AnimationRef,
  capabilities: PartnerCapabilities,
  now: Date
): QueuedAnimationIntent[] {
  return [
    {
      animation: selectAnimation(workflowDone, capabilities),
      reason: "physical-override",
      expiresAt: new Date(now.getTime() + DONE_QUEUE_TTL_MS).toISOString()
    }
  ];
}

function preserveOrQueueDoneAnimation(
  activeQueue: QueuedAnimationIntent[],
  workflowDone: AnimationRef,
  capabilities: PartnerCapabilities,
  now: Date
): QueuedAnimationIntent[] {
  return activeQueue.length > 0 ? activeQueue : queueDoneAnimation(workflowDone, capabilities, now);
}

function activeQueuedAnimations(
  queued: QueuedAnimationIntent[],
  now: Date
): QueuedAnimationIntent[] {
  return queued.filter((item) => Date.parse(item.expiresAt) > now.getTime());
}

function missingFrameSource(): AnimationFrameSource {
  return {
    kind: "missing",
    reason: "animation-unavailable"
  };
}
