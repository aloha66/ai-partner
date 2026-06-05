import {
  ANIMATION_INTENT_SCHEMA_VERSION,
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
import { type PhysicalState } from "./physical";

export interface ResolveAnimationOptions {
  now?: Date;
  queued?: QueuedAnimationIntent[];
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
  const replayQueued = physicalState === "normal" ? activeQueue[0] : undefined;
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
    fallbackLoop: physicalTarget ? loopByPhysical[physicalState] ?? true : true
  });
  const queued =
    snapshot.workflowState === "done" && physicalState !== "normal"
      ? preserveOrQueueDoneAnimation(activeQueue, workflowTarget, mergedCapabilities, now)
      : activeQueue;

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
  fallback: { fallbackProcedural: ProceduralEffect[]; fallbackLoop: boolean }
): BodyAnimationIntent {
  const animation = selectAnimation(requested, capabilities);
  const timeline = capabilities.animations[animation];
  const procedural = new Set<ProceduralEffect>([
    ...(timeline?.procedural ?? []),
    ...fallback.fallbackProcedural
  ]);

  return {
    animation,
    procedural: [...procedural],
    loop: timeline?.loop ?? fallback.fallbackLoop
  };
}

function selectAnimation(
  requested: AnimationRef,
  capabilities: PartnerCapabilities
): AnimationRef {
  if (capabilities.animations[requested]) {
    return requested;
  }
  for (const fallback of capabilities.fallbacks[requested] ?? []) {
    if (capabilities.animations[fallback]) {
      return fallback;
    }
  }
  return capabilities.animations["legacy.idle"] ? "legacy.idle" : requested;
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
