import { request } from "node:http";
import type { RuntimeDescriptor } from "@ai-partner/contracts";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultPostTimeoutMs } from "./constants.js";
import { DebugCliError } from "./errors.js";
import { defaultRuntimeDescriptorPath, discoverRuntime } from "./discovery.js";

export type PartnerToggleAction = "started" | "stopped";

export interface PartnerToggleResult {
  action: PartnerToggleAction;
  appPath?: string;
  descriptorPath: string;
}

export interface TogglePartnerOptions {
  appPath?: string;
  descriptorPath?: string;
  connectTimeoutMs?: number;
  postTimeoutMs?: number;
  discover?: typeof discoverRuntime;
  quit?: typeof quitPartnerRuntime;
  launch?: typeof launchPartnerApp;
}

export async function togglePartner(
  options: TogglePartnerOptions = {}
): Promise<PartnerToggleResult> {
  const descriptorPath = options.descriptorPath ?? defaultRuntimeDescriptorPath();
  const discover = options.discover ?? discoverRuntime;

  try {
    const descriptor = await discover({
      descriptorPath,
      connectTimeoutMs: options.connectTimeoutMs
    });
    await (options.quit ?? quitPartnerRuntime)(descriptor, {
      timeoutMs: options.postTimeoutMs
    });
    return {
      action: "stopped",
      descriptorPath
    };
  } catch (error) {
    if (!shouldStartPartner(error)) {
      throw error;
    }
  }

  const appPath = resolvePartnerAppPath(options.appPath);
  await (options.launch ?? launchPartnerApp)(appPath);
  return {
    action: "started",
    appPath,
    descriptorPath
  };
}

export interface QuitPartnerRuntimeOptions {
  timeoutMs?: number;
  post?: (
    descriptor: RuntimeDescriptor,
    timeoutMs: number
  ) => Promise<{ status: number; body: string }>;
}

export async function quitPartnerRuntime(
  descriptor: RuntimeDescriptor,
  options: QuitPartnerRuntimeOptions = {}
): Promise<void> {
  const result = await (options.post ?? postQuitControl)(
    descriptor,
    options.timeoutMs ?? defaultPostTimeoutMs
  );
  if (result.status === 202) {
    return;
  }
  if (result.status === 401) {
    throw new DebugCliError("Local ingress rejected the runtime bearer token.", "unauthorized");
  }
  throw new DebugCliError(
    `Local ingress rejected partner quit with HTTP ${result.status}: ${result.body}`,
    "quit_failed"
  );
}

export function resolvePartnerAppPath(appPath: string | undefined): string {
  return (
    appPath ??
    process.env.AI_PARTNER_APP_PATH ??
    resolve(process.cwd(), "src-tauri/target/release/bundle/macos/AI Partner.app")
  );
}

export async function launchPartnerApp(appPath: string): Promise<void> {
  await assertAppPathExists(appPath);
  await runOpen(appPath);
}

async function assertAppPathExists(appPath: string): Promise<void> {
  try {
    await access(appPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DebugCliError(
      `AI Partner app was not found at ${appPath}. Build or install the packaged app first, or pass --app-path. ${message}`,
      "app_missing"
    );
  }
}

function runOpen(appPath: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("open", ["-g", "-n", appPath], {
      stdio: "ignore"
    });
    child.on("error", (error) =>
      reject(new DebugCliError(error.message, "launch_failed"))
    );
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new DebugCliError(
          `open exited with ${signal === null ? `code ${code}` : `signal ${signal}`}.`,
          "launch_failed"
        )
      );
    });
  });
}

function postQuitControl(
  descriptor: RuntimeDescriptor,
  timeoutMs: number
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: descriptor.port,
        path: "/control/quit",
        method: "POST",
        headers: {
          Authorization: `Bearer ${descriptor.token}`,
          "Content-Length": "0"
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolvePromise({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
      }
    );
    req.on("timeout", () => {
      req.destroy(new DebugCliError("Local ingress quit request timed out.", "connection_failed"));
    });
    req.on("error", (error) => {
      reject(
        error instanceof DebugCliError
          ? error
          : new DebugCliError(error.message, "connection_failed")
      );
    });
    req.end();
  });
}

function shouldStartPartner(error: unknown): boolean {
  return (
    error instanceof DebugCliError &&
    [
      "descriptor_missing",
      "descriptor_stale",
      "endpoint_unreachable"
    ].includes(error.code)
  );
}
