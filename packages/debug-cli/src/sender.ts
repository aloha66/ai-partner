import { request } from "node:http";
import type { RequestOptions } from "node:http";
import type { RuntimeDescriptor, WorkflowEventWire, WorkflowSource } from "@ai-partner/contracts";
import { WORKFLOW_EVENT_SCHEMA_VERSION, defaultPostTimeoutMs } from "./constants.js";
import { DebugCliError } from "./errors.js";
import { assertNoForbiddenFields, normalizeMessage } from "./workflowEvent.js";

export interface SendWorkflowEventOptions {
  timeoutMs?: number;
  allowedSources?: readonly WorkflowSource[];
  post?: (
    descriptor: RuntimeDescriptor,
    body: string,
    timeoutMs: number
  ) => Promise<SendWorkflowEventResult>;
}

export interface SendWorkflowEventResult {
  status: number;
  body: string;
}

const contractWorkflowSources = [
  "cli",
  "codex-wrapper",
  "demo-script"
] as const satisfies readonly WorkflowSource[];

export async function sendWorkflowEvent(
  descriptor: RuntimeDescriptor,
  event: WorkflowEventWire,
  options: SendWorkflowEventOptions = {}
): Promise<SendWorkflowEventResult> {
  const payload = workflowEventPayloadForPost(event, {
    allowedSources: options.allowedSources
  });

  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > 4 * 1024) {
    throw new DebugCliError("Workflow event payload exceeds 4KB.", "payload_too_large");
  }

  const result = await (options.post ?? postJson)(
    descriptor,
    body,
    options.timeoutMs ?? defaultPostTimeoutMs
  );
  if (result.status === 202) {
    return result;
  }
  if (result.status === 401) {
    throw new DebugCliError("Local ingress rejected the runtime bearer token.", "unauthorized");
  }
  throw new DebugCliError(
    `Local ingress rejected workflow event with HTTP ${result.status}: ${result.body}`,
    "post_failed"
  );
}

export interface WorkflowEventPayloadOptions {
  allowedSources?: readonly WorkflowSource[];
}

export function workflowEventPayloadForPost(
  event: WorkflowEventWire,
  options: WorkflowEventPayloadOptions = {}
): WorkflowEventWire {
  assertNoForbiddenFields(event);
  if (event.schemaVersion !== WORKFLOW_EVENT_SCHEMA_VERSION) {
    throw new DebugCliError("Workflow event schemaVersion is unsupported.", "invalid_event");
  }
  if (!contractWorkflowSources.includes(event.source)) {
    throw new DebugCliError("Workflow event source is unsupported.", "invalid_event");
  }

  const allowedSources: readonly WorkflowSource[] = options.allowedSources ?? ["cli"];
  if (!allowedSources.includes(event.source)) {
    throw new DebugCliError(
      `Workflow event source ${event.source} is not allowed by this sender.`,
      "invalid_event"
    );
  }
  if (event.code_context_allowed !== false) {
    throw new DebugCliError("Workflow event code_context_allowed must be false.", "unsafe_payload");
  }

  const message = normalizeMessage(event.message);
  return {
    schemaVersion: event.schemaVersion,
    event_id: event.event_id,
    source: event.source,
    run_id: event.run_id,
    workflow_state: event.workflow_state,
    timestamp: event.timestamp,
    ...(message === undefined ? {} : { message }),
    code_context_allowed: false
  };
}

function postJson(
  descriptor: RuntimeDescriptor,
  body: string,
  timeoutMs: number
): Promise<SendWorkflowEventResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      createWorkflowEventRequestOptions(descriptor, body, timeoutMs),
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new DebugCliError("Local ingress request timed out.", "connection_failed"));
    });
    req.on("error", (error) => {
      reject(
        error instanceof DebugCliError
          ? error
          : new DebugCliError(error.message, "connection_failed")
      );
    });
    req.end(body);
  });
}

export function createWorkflowEventRequestOptions(
  descriptor: RuntimeDescriptor,
  body: string,
  timeoutMs: number
): RequestOptions {
  return {
    hostname: "127.0.0.1",
    port: descriptor.port,
    path: "/events",
    method: "POST",
    headers: {
      Authorization: `Bearer ${descriptor.token}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body, "utf8")
    },
    timeout: timeoutMs
  };
}
