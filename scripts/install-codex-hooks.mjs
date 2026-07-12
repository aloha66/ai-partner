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
  "Stop"
];
const retiredHookEvents = ["SubagentStart", "SubagentStop"];
const managedHookEvents = [...hookEvents, ...retiredHookEvents];

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
  const merged = mergeAiPartnerHooks(existing.config);

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
    return normalizeHooksFile(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { config: { hooks: {} }, schema: "missing" };
    }
    throw error;
  }
}

function mergeAiPartnerHooks(existing) {
  const next = { hooks: { ...existing.hooks } };

  for (const eventName of managedHookEvents) {
    const groups = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
    const preserved = groups
      .map((group) => removeAiPartnerHandlers(group))
      .filter((group) => group.hooks.length > 0);
    if (hookEvents.includes(eventName)) {
      next.hooks[eventName] = [
        ...preserved,
        {
          matcher: null,
          hooks: [createAiPartnerHandler(eventName)]
        }
      ];
    } else if (preserved.length > 0) {
      next.hooks[eventName] = preserved;
    } else {
      delete next.hooks[eventName];
    }
  }

  return next;
}

function normalizeHooksFile(parsed) {
  const rootKeys = Object.keys(parsed);
  if (isPlainObject(parsed.hooks)) {
    return {
      config: { hooks: normalizeHooksMap(parsed.hooks) },
      schema: rootKeys.every((key) => key === "hooks") ? "current" : "invalid-root"
    };
  }

  const legacyHooks = legacyHooksMap(parsed);
  if (Object.keys(legacyHooks).length > 0) {
    return {
      config: { hooks: legacyHooks },
      schema: "legacy"
    };
  }

  return {
    config: { hooks: {} },
    schema: rootKeys.length === 0 ? "missing" : "invalid-root"
  };
}

function normalizeHooksMap(hooks) {
  const normalized = {};
  for (const [eventName, groups] of Object.entries(hooks)) {
    if (Array.isArray(groups)) {
      normalized[eventName] = groups;
    }
  }
  return normalized;
}

function legacyHooksMap(root) {
  const hooks = {};
  for (const eventName of managedHookEvents) {
    if (Array.isArray(root[eventName])) {
      hooks[eventName] = root[eventName];
    }
  }
  return hooks;
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

  if (existing.schema === "missing") {
    problems.push(`missing hooks file: ${targetPath}`);
  } else if (existing.schema !== "current") {
    problems.push(
      `hooks file uses deprecated or invalid Codex hook schema: ${targetPath}; run pnpm partner:install to rewrite it`
    );
  }

  for (const eventName of hookEvents) {
    const groups = Array.isArray(existing.config.hooks[eventName])
      ? existing.config.hooks[eventName]
      : [];
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
