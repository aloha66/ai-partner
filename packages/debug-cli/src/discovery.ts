import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeDescriptor } from "@ai-partner/contracts";
import {
  defaultConnectTimeoutMs,
  descriptorDirName,
  descriptorFileName,
  descriptorFutureSkewMs,
  descriptorMaxAgeMs,
  RUNTIME_DESCRIPTOR_SCHEMA_VERSION
} from "./constants.js";
import { DebugCliError } from "./errors.js";

export interface DiscoverRuntimeOptions {
  descriptorPath?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  connectTimeoutMs?: number;
  maxAgeMs?: number;
  futureSkewMs?: number;
  skipEndpointCheck?: boolean;
  processAlive?: (pid: number) => boolean;
  endpointReachable?: (port: number, timeoutMs: number) => Promise<void>;
}

export function defaultRuntimeDescriptorPath(env = process.env): string {
  return join(env.TMPDIR ?? tmpdir(), descriptorDirName, descriptorFileName);
}

export async function discoverRuntime(
  options: DiscoverRuntimeOptions = {}
): Promise<RuntimeDescriptor> {
  const descriptorPath = options.descriptorPath ?? defaultRuntimeDescriptorPath(options.env);
  const descriptor = await readRuntimeDescriptor(descriptorPath);

  validateRuntimeDescriptorFreshness(descriptor, {
    now: options.now,
    maxAgeMs: options.maxAgeMs,
    futureSkewMs: options.futureSkewMs,
    processAlive: options.processAlive
  });

  if (!options.skipEndpointCheck) {
    await (options.endpointReachable ?? assertEndpointReachable)(
      descriptor.port,
      options.connectTimeoutMs ?? defaultConnectTimeoutMs
    );
  }

  return descriptor;
}

export async function readRuntimeDescriptor(path: string): Promise<RuntimeDescriptor> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DebugCliError(
      `Runtime descriptor not found at ${path}. Start ai-partner first. ${message}`,
      "descriptor_missing"
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DebugCliError(`Runtime descriptor is not valid JSON: ${message}`, "descriptor_invalid");
  }

  return parseRuntimeDescriptor(value);
}

export function parseRuntimeDescriptor(value: unknown): RuntimeDescriptor {
  if (!isRecord(value)) {
    throw new DebugCliError("Runtime descriptor must be a JSON object.", "descriptor_invalid");
  }

  const descriptor = value as Record<string, unknown>;
  if (descriptor.schemaVersion !== RUNTIME_DESCRIPTOR_SCHEMA_VERSION) {
    throw new DebugCliError("Runtime descriptor schemaVersion is unsupported.", "descriptor_stale");
  }
  if (!isContractId(descriptor.appInstanceId, "app_")) {
    throw new DebugCliError("Runtime descriptor appInstanceId is invalid.", "descriptor_invalid");
  }
  if (!Number.isInteger(descriptor.pid) || (descriptor.pid as number) < 1) {
    throw new DebugCliError("Runtime descriptor pid is invalid.", "descriptor_stale");
  }
  if (
    !Number.isInteger(descriptor.port) ||
    (descriptor.port as number) < 1 ||
    (descriptor.port as number) > 65_535
  ) {
    throw new DebugCliError("Runtime descriptor port is invalid.", "descriptor_stale");
  }
  if (
    typeof descriptor.token !== "string" ||
    descriptor.token.length < 16 ||
    descriptor.token.length > 256 ||
    !/^[A-Za-z0-9._~+/=-]+$/.test(descriptor.token)
  ) {
    throw new DebugCliError("Runtime descriptor token is invalid.", "descriptor_stale");
  }
  if (typeof descriptor.createdAt !== "string" || Number.isNaN(Date.parse(descriptor.createdAt))) {
    throw new DebugCliError("Runtime descriptor createdAt is invalid.", "descriptor_stale");
  }

  return {
    schemaVersion: RUNTIME_DESCRIPTOR_SCHEMA_VERSION,
    appInstanceId: descriptor.appInstanceId,
    pid: descriptor.pid as number,
    port: descriptor.port as number,
    token: descriptor.token,
    createdAt: descriptor.createdAt
  };
}

export function validateRuntimeDescriptorFreshness(
  descriptor: RuntimeDescriptor,
  options: Pick<
    DiscoverRuntimeOptions,
    "futureSkewMs" | "maxAgeMs" | "now" | "processAlive"
  > = {}
): void {
  const processAlive = options.processAlive ?? defaultProcessAlive;
  if (!processAlive(descriptor.pid)) {
    throw new DebugCliError("Runtime descriptor process is not alive.", "descriptor_stale");
  }

  const nowMs = (options.now ?? new Date()).getTime();
  const createdAtMs = Date.parse(descriptor.createdAt);
  const futureSkewMs = options.futureSkewMs ?? descriptorFutureSkewMs;
  const maxAgeMs = options.maxAgeMs ?? descriptorMaxAgeMs;

  if (createdAtMs - nowMs > futureSkewMs) {
    throw new DebugCliError("Runtime descriptor createdAt is in the future.", "descriptor_stale");
  }
  if (maxAgeMs !== undefined && nowMs - createdAtMs > maxAgeMs) {
    throw new DebugCliError("Runtime descriptor is stale by age.", "descriptor_stale");
  }
}

export function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

export async function assertEndpointReachable(
  port: number,
  timeoutMs = defaultConnectTimeoutMs,
  probe: (
    port: number,
    timeoutMs: number
  ) => Promise<{ status: number; body: string }> = probeEndpointReachable
): Promise<void> {
  const result = await probe(port, timeoutMs);

  if (result.status !== 405) {
    throw new DebugCliError(
      `Endpoint 127.0.0.1:${port} responded with unexpected HTTP ${result.status}${formatEndpointBody(result.body)}.`,
      "endpoint_unreachable"
    );
  }
}

function probeEndpointReachable(
  port: number,
  timeoutMs: number
): Promise<{ status: number; body: string }> {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    let settled = false;
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/events",
        method: "GET",
        headers: {
          "Content-Length": "0"
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          finish(undefined, {
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
      }
    );

    function finish(error?: Error, result = { status: 0, body: "" }): void {
      if (settled) {
        return;
      }
      settled = true;
      req.destroy();
      if (error) {
        reject(new DebugCliError(error.message, "endpoint_unreachable"));
      } else {
        resolve(result);
      }
    }

    req.on("timeout", () => {
      finish(new Error(`Endpoint 127.0.0.1:${port} did not respond within ${timeoutMs}ms.`));
    });
    req.on("error", (error) => finish(error));
    req.end();
  });
}

function formatEndpointBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length === 0 ? "" : `: ${trimmed.slice(0, 200)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContractId(value: unknown, prefix: string): value is string {
  return (
    typeof value === "string" &&
    value.length <= 120 &&
    value.startsWith(prefix) &&
    value.length > prefix.length &&
    /^[A-Za-z0-9._:-]+$/.test(value.slice(prefix.length))
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
