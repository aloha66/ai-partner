#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { asDebugCliError, defaultRuntimeDescriptorPath } from "@ai-partner/debug-cli";
import { runCodexWrapper } from "./runner.js";

interface ParsedCliArgs {
  codexCommand: string;
  codexArgs: string[];
  descriptorPath?: string;
  runId?: string;
  help: boolean;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const exitCode = await runCodexWrapper({
    codexCommand: args.codexCommand,
    codexArgs: args.codexArgs,
    descriptorPath: args.descriptorPath,
    runId: args.runId
  });
  process.exitCode = exitCode;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  let codexCommand = "codex";
  let descriptorPath: string | undefined;
  let runId: string | undefined;
  const codexArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      return { codexCommand, codexArgs, descriptorPath, runId, help: true };
    }
    if (arg === "--") {
      codexArgs.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--codex-bin") {
      codexCommand = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--codex-bin=")) {
      codexCommand = arg.slice("--codex-bin=".length);
      continue;
    }
    if (arg === "--descriptor") {
      descriptorPath = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--descriptor=")) {
      descriptorPath = arg.slice("--descriptor=".length);
      continue;
    }
    if (arg === "--run-id") {
      runId = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
      continue;
    }

    codexArgs.push(...argv.slice(index));
    break;
  }

  return { codexCommand, codexArgs, descriptorPath, runId, help: false };
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function printHelp(): void {
  console.log(`ai-partner-codex

Usage:
  ai-partner-codex [wrapper options] -- <codex args...>
  ai-partner-codex [wrapper options] exec --json "prompt"

Wrapper options:
  --codex-bin <path>    Codex executable to run. Defaults to codex.
  --descriptor <path>   Runtime descriptor path.
  --run-id <run_id>     Stable run id for tests or diagnostics.

Default descriptor:
  ${defaultRuntimeDescriptorPath()}
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const debugError = asDebugCliError(error);
    console.error(`${debugError.code}: ${debugError.message}`);
    process.exitCode = debugError.code === "usage" ? 2 : 1;
  });
}
