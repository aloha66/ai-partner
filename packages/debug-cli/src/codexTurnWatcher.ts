import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export type CodexTurnEnd = "aborted" | "completed" | "timed_out";

export interface WaitForCodexTurnEndOptions {
  sessionId: string;
  turnId: string;
  sessionsRoot?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const defaultPollIntervalMs = 250;
const defaultTimeoutMs = 6 * 60 * 60 * 1000;

// Codex does not run Stop hooks for a manually interrupted Desktop turn. Its
// local session transcript is the only lifecycle signal available in that case.
export async function waitForCodexTurnEnd(
  options: WaitForCodexTurnEndOptions
): Promise<CodexTurnEnd> {
  const sessionsRoot = options.sessionsRoot ?? join(homedir(), ".codex", "sessions");
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let transcriptPath: string | undefined;
  let offset = 0;
  let pending = "";

  while (Date.now() < deadline) {
    transcriptPath ??= await findCodexSessionTranscript(sessionsRoot, options.sessionId);
    if (transcriptPath !== undefined) {
      const update = await readNewLines(transcriptPath, offset, pending);
      offset = update.offset;
      pending = update.pending;
      for (const line of update.lines) {
        const end = codexTurnEndForTranscriptLine(line, options.turnId);
        if (end !== undefined) {
          return end;
        }
      }
    }
    await sleep(pollIntervalMs);
  }

  return "timed_out";
}

export function codexTurnEndForTranscriptLine(
  line: string,
  turnId: string
): Exclude<CodexTurnEnd, "timed_out"> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }

  const record = asRecord(value);
  if (record.method === "turn/completed") {
    const params = asRecord(record.params);
    const turn = asRecord(params.turn);
    return readString(turn, "id") === turnId ? "completed" : undefined;
  }

  if (record.type !== "event_msg") {
    return undefined;
  }
  const payload = asRecord(record.payload);
  if (readString(payload, "turn_id") !== turnId) {
    return undefined;
  }
  if (payload.type === "turn_aborted") {
    return "aborted";
  }
  return payload.type === "task_complete" ? "completed" : undefined;
}

async function findCodexSessionTranscript(
  sessionsRoot: string,
  sessionId: string
): Promise<string | undefined> {
  return findTranscriptInDirectory(sessionsRoot, `-${sessionId}.jsonl`, 3);
}

async function findTranscriptInDirectory(
  directory: string,
  suffix: string,
  depth: number
): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      return join(directory, entry.name);
    }
  }
  if (depth === 0) {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const found = await findTranscriptInDirectory(join(directory, entry.name), suffix, depth - 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

async function readNewLines(
  path: string,
  previousOffset: number,
  previousPending: string
): Promise<{ lines: string[]; offset: number; pending: string }> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    const reset = size < previousOffset;
    const offset = reset ? 0 : previousOffset;
    if (size === offset) {
      return { lines: [], offset, pending: reset ? "" : previousPending };
    }

    let position = offset;
    let text = reset ? "" : previousPending;
    while (position < size) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size - position));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      position += bytesRead;
      text += buffer.subarray(0, bytesRead).toString("utf8");
    }

    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline < 0) {
      return { lines: [], offset: position, pending: text };
    }
    const lines = text.slice(0, lastNewline).split("\n");
    return {
      lines,
      offset: position,
      pending: text.slice(lastNewline + 1)
    };
  } finally {
    await file.close();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
