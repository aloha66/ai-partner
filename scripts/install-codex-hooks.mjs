#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/debug-cli/dist/cli.js");
const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const targetPath = join(codexHome, "hooks.json");

const hookEvents = [
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "Stop"
];

const mode = process.argv.includes("--write")
  ? "write"
  : process.argv.includes("--check")
    ? "check"
    : process.argv.includes("--warn")
      ? "warn"
      : process.argv.includes("--print")
        ? "print"
        : undefined;

if (mode === undefined) {
  console.error("usage: node scripts/install-codex-hooks.mjs --check|--write|--warn|--print");
  process.exitCode = 2;
} else {
  let existing;
  try {
    existing = await readExistingHooks(targetPath);
  } catch (error) {
    if (mode === "warn") {
      console.warn(
        `AI Partner Codex hooks could not be checked; run pnpm partner:install to repair live Codex status updates.`
      );
      console.warn(`- ${formatError(error)}`);
      process.exit(0);
    }
    throw error;
  }
  const merged = mergeAiPartnerHooks(existing);

  if (mode === "print") {
    process.stdout.write(`${JSON.stringify(merged, null, 2)}\n`);
  }

  if (mode === "check") {
    const problems = await installationProblems(existing);
    if (problems.length > 0) {
      for (const problem of problems) {
        console.error(problem);
      }
      process.exitCode = 1;
    } else {
      console.log(`codex hooks installed at ${targetPath}`);
    }
  }

  if (mode === "warn") {
    const problems = await installationProblems(existing);
    if (problems.length > 0) {
      console.warn(
        `AI Partner Codex hooks are not fully installed; run pnpm partner:install to enable live Codex status updates.`
      );
      for (const problem of problems) {
        console.warn(`- ${problem}`);
      }
    }
  }

  if (mode === "write") {
    await assertBuiltHookCli();
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`installed AI Partner Codex hooks at ${targetPath}`);
  }
}

async function readExistingHooks(path) {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new Error("hooks.json root must be an object");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function mergeAiPartnerHooks(existing) {
  const next = { ...existing };
  next.managedDir ??= null;
  next.windowsManagedDir ??= null;

  for (const eventName of hookEvents) {
    const groups = Array.isArray(next[eventName]) ? next[eventName] : [];
    const preserved = groups
      .map((group) => removeAiPartnerHandlers(group))
      .filter((group) => group.hooks.length > 0);
    next[eventName] = [
      ...preserved,
      {
        matcher: null,
        hooks: [createAiPartnerHandler(eventName)]
      }
    ];
  }

  return next;
}

function createAiPartnerHandler(eventName) {
  return {
    type: "command",
    command: hookCommand(eventName),
    commandWindows: null,
    timeoutSec: 2,
    async: false,
    statusMessage: null
  };
}

function hookCommand(eventName) {
  return `${shellQuote(process.execPath)} ${shellQuote(cliPath)} codex-hook --event ${eventName} --post-timeout-ms 750`;
}

function removeAiPartnerHandlers(group) {
  if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
    return { matcher: null, hooks: [] };
  }
  return {
    ...group,
    hooks: group.hooks.filter((hook) => !isAiPartnerHook(hook))
  };
}

function isAiPartnerHook(hook) {
  return (
    isPlainObject(hook) &&
    hook.type === "command" &&
    typeof hook.command === "string" &&
    hook.command.includes("codex-hook") &&
    hook.command.includes("debug-cli/dist/cli.js")
  );
}

async function installationProblems(existing) {
  const problems = [];
  try {
    await assertBuiltHookCli();
  } catch (error) {
    problems.push(error.message);
  }

  if (Object.keys(existing).length === 0) {
    problems.push(`missing hooks file: ${targetPath}`);
  }

  for (const eventName of hookEvents) {
    const groups = Array.isArray(existing[eventName]) ? existing[eventName] : [];
    const installed = groups.some((group) =>
      isPlainObject(group) &&
      Array.isArray(group.hooks) &&
      group.hooks.some((hook) => isAiPartnerHook(hook) && hook.command === hookCommand(eventName))
    );
    if (!installed) {
      problems.push(`missing AI Partner hook for ${eventName}`);
    }
  }

  return problems;
}

async function assertBuiltHookCli() {
  try {
    await access(cliPath, fsConstants.R_OK);
  } catch {
    throw new Error(
      `missing built hook CLI: ${cliPath}; run pnpm --filter @ai-partner/debug-cli build`
    );
  }
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
