import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { descriptorDirName } from "./constants.js";

export interface DebugSessionState {
  runId: string;
  updatedAt: string;
}

export function defaultDebugSessionPath(): string {
  return join(tmpdir(), descriptorDirName, "debug-session.json");
}

export async function readDebugSessionRunId(path = defaultDebugSessionPath()): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<DebugSessionState>;
    return typeof parsed.runId === "string" && parsed.runId.startsWith("run_")
      ? parsed.runId
      : undefined;
  } catch {
    return undefined;
  }
}

export async function writeDebugSessionRunId(runId: string, path = defaultDebugSessionPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    JSON.stringify({ runId, updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
}
