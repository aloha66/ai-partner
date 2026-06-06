import type { WorkflowState } from "@ai-partner/contracts";

export type CodexWrapperWorkflowState = Exclude<WorkflowState, "idle">;

export type CodexSignalKind = "structured" | "fallback" | "exit";

export interface CodexClassifierSignal {
  state: CodexWrapperWorkflowState;
  kind: CodexSignalKind;
  matcher: string;
  confidence: "high" | "medium" | "low";
}

const workflowStates = [
  "running",
  "reading",
  "editing",
  "waiting",
  "error",
  "done"
] as const satisfies readonly CodexWrapperWorkflowState[];

const structuredStateKeys = [
  "workflow_state",
  "workflowState",
  "state",
  "status",
  "phase"
] as const;

const structuredTypeKeys = [
  "type",
  "event",
  "event_type",
  "eventType",
  "kind",
  "name"
] as const;

const structuredMatchers: Array<{
  state: CodexWrapperWorkflowState;
  matcher: string;
  pattern: RegExp;
}> = [
  {
    state: "waiting",
    matcher: "structured.waiting",
    pattern: /\b(waiting|input_required|approval|approval_requested|confirm|confirmation|permission)\b/i
  },
  {
    state: "editing",
    matcher: "structured.editing",
    pattern: /\b(edit|editing|patch|apply_patch|write|file_change|modified)\b/i
  },
  {
    state: "reading",
    matcher: "structured.reading",
    pattern: /\b(read|reading|search|grep|rg|list|inspect|open_file|view)\b/i
  },
  {
    state: "error",
    matcher: "structured.error",
    pattern: /\b(error|failed|failure|exception|panic)\b/i
  },
  {
    state: "done",
    matcher: "structured.done",
    pattern: /\b(done|complete|completed|finished|turn_completed)\b/i
  },
  {
    state: "running",
    matcher: "structured.running",
    pattern: /\b(running|started|start|turn_started|reasoning|message)\b/i
  }
];

const fallbackMatchers: Array<{
  state: CodexWrapperWorkflowState;
  matcher: string;
  pattern: RegExp;
}> = [
  {
    state: "waiting",
    matcher: "text.waiting",
    pattern: /\b(waiting for|requires approval|approval required|confirm|permission)\b/i
  },
  {
    state: "editing",
    matcher: "text.editing",
    pattern: /\b(apply_patch|patch applied|modified|updated|wrote|writing file|editing)\b/i
  },
  {
    state: "reading",
    matcher: "text.reading",
    pattern: /\b(reading|searching|inspecting|listing files|opened file|rg\b|grep\b)\b/i
  },
  {
    state: "error",
    matcher: "text.error",
    pattern: /\b(error|failed|failure|exception|panic)\b/i
  }
];

export function classifyCodexLine(line: string): CodexClassifierSignal {
  const structured = classifyStructuredCodexLine(line);
  if (structured !== undefined) {
    return structured;
  }

  const fallback = classifyTextCodexLine(line);
  if (fallback !== undefined) {
    return fallback;
  }

  return {
    state: "running",
    kind: "fallback",
    matcher: "text.unknown",
    confidence: "low"
  };
}

export function classifyStructuredCodexLine(
  line: string
): CodexClassifierSignal | undefined {
  const value = parseJsonObject(line);
  if (value === undefined) {
    return undefined;
  }

  for (const key of structuredStateKeys) {
    const state = workflowStateFromUnknown(value[key]);
    if (state !== undefined) {
      return {
        state,
        kind: "structured",
        matcher: `structured.${key}`,
        confidence: "high"
      };
    }
  }

  for (const key of structuredTypeKeys) {
    const eventName = stringFromUnknown(value[key]);
    if (eventName === undefined) {
      continue;
    }
    for (const matcher of structuredMatchers) {
      if (matcher.pattern.test(eventName)) {
        return {
          state: matcher.state,
          kind: "structured",
          matcher: matcher.matcher,
          confidence: "medium"
        };
      }
    }
  }

  return {
    state: "running",
    kind: "structured",
    matcher: "structured.unknown",
    confidence: "low"
  };
}

export function classifyTextCodexLine(line: string): CodexClassifierSignal | undefined {
  for (const matcher of fallbackMatchers) {
    if (matcher.pattern.test(line)) {
      return {
        state: matcher.state,
        kind: "fallback",
        matcher: matcher.matcher,
        confidence: "low"
      };
    }
  }
  return undefined;
}

export function classifyCodexExit(exitCode: number | null, signal: string | null): CodexClassifierSignal {
  if (exitCode === 0 && signal === null) {
    return {
      state: "done",
      kind: "exit",
      matcher: "exit.0",
      confidence: "high"
    };
  }

  return {
    state: "error",
    kind: "exit",
    matcher: signal === null ? "exit.nonzero" : "exit.signal",
    confidence: "high"
  };
}

export function isCodexWrapperWorkflowState(
  value: string
): value is CodexWrapperWorkflowState {
  return workflowStates.includes(value as CodexWrapperWorkflowState);
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function workflowStateFromUnknown(value: unknown): CodexWrapperWorkflowState | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return isCodexWrapperWorkflowState(value) ? value : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
