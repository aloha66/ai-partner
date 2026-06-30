#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function runPartnerScript(
  argv = process.argv.slice(2),
  runner = runCommand
) {
  const partnerArgs = argv[0] === "--" ? argv.slice(1) : argv;
  await runner("pnpm", ["--filter", "@ai-partner/debug-cli", "build"]);
  await runner(process.execPath, [
    join(repoRoot, "packages/debug-cli/dist/cli.js"),
    "partner",
    ...partnerArgs
  ]);
  await runner(process.execPath, [join(repoRoot, "scripts/install-codex-hooks.mjs"), "--warn"]);
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} exited with ${signal === null ? `code ${code}` : `signal ${signal}`}.`));
    });
  });
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  runPartnerScript().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
