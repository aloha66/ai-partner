#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(repoRoot, "skills", "partner");
const defaultTargetDir = join(repoRoot, ".agents", "skills", "partner");

const args = parseArgs(process.argv.slice(2));
const mode = args.check ? "check" : args.write ? "write" : "dry-run";
const targetDir = resolve(args.target ?? defaultTargetDir);

await assertDirectory(sourceDir, "source skill");

if (mode === "dry-run") {
  const files = await listFiles(sourceDir);
  console.log(`partner skill source: ${sourceDir}`);
  console.log(`partner skill target: ${targetDir}`);
  console.log("dry-run only; pass --write to sync the target directory.");
  for (const file of files) {
    console.log(`  ${file}`);
  }
  process.exit(0);
}

if (mode === "check") {
  if (!existsSync(targetDir)) {
    console.error(`partner skill target is missing: ${targetDir}`);
    process.exit(1);
  }
  const sourceHash = await directoryHash(sourceDir);
  const targetHash = await directoryHash(targetDir);
  if (sourceHash !== targetHash) {
    console.error(`partner skill target is stale: ${targetDir}`);
    process.exit(1);
  }
  console.log(`partner skill target is current: ${targetDir}`);
  process.exit(0);
}

await mkdir(dirname(targetDir), { recursive: true });
await rm(targetDir, { recursive: true, force: true });
await cp(sourceDir, targetDir, { recursive: true });
console.log(`synced partner skill to ${targetDir}`);

function parseArgs(argv) {
  const parsed = {
    check: false,
    write: false,
    target: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      parsed.check = true;
    } else if (arg === "--write") {
      parsed.write = true;
    } else if (arg === "--target") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--target requires a path.");
      }
      parsed.target = value;
      index += 1;
    } else if (arg.startsWith("--target=")) {
      parsed.target = arg.slice("--target=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.check && parsed.write) {
    throw new Error("--check and --write cannot be used together.");
  }
  return parsed;
}

async function assertDirectory(path, label) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    throw new Error(`${label} directory is missing at ${path}: ${error.message}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`${label} path is not a directory: ${path}`);
  }
}

async function directoryHash(root) {
  const hash = createHash("sha256");
  for (const file of await listFiles(root)) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function listFiles(root, prefix = "") {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".DS_Store") {
      continue;
    }
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

function printHelp() {
  console.log(`sync-partner-skill

Usage:
  node scripts/sync-partner-skill.mjs
  node scripts/sync-partner-skill.mjs --check [--target path]
  node scripts/sync-partner-skill.mjs --write [--target path]

Default target:
  ${relative(repoRoot, defaultTargetDir)}
`);
}
