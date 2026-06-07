#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

if (process.platform !== "darwin") {
  console.error("M5 DMG packaging must run on macOS.");
  process.exit(1);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

const tauriConfig = readJson("src-tauri/tauri.conf.json");
const productName = tauriConfig.productName ?? "AI Partner";
const version = tauriConfig.version ?? "0.1.0";
const arch = process.arch === "arm64" ? "aarch64" : process.arch;

const bundleRoot = join(root, "src-tauri", "target", "release", "bundle");
const appPath = join(bundleRoot, "macos", `${productName}.app`);
const dmgDir = join(bundleRoot, "dmg");
const stagingDir = join(dmgDir, "internal-dmg-staging");
const dmgPath = join(dmgDir, `${productName}_${version}_${arch}.dmg`);

if (!existsSync(appPath)) {
  console.error(`Packaged app not found: ${appPath}`);
  console.error("Run pnpm tauri:build:app before packaging the DMG.");
  process.exit(1);
}

rmSync(stagingDir, { recursive: true, force: true });
rmSync(dmgPath, { force: true });
mkdirSync(stagingDir, { recursive: true });

cpSync(appPath, join(stagingDir, `${productName}.app`), {
  recursive: true,
  preserveTimestamps: true,
});
symlinkSync("/Applications", join(stagingDir, "Applications"));

execFileSync(
  "hdiutil",
  [
    "create",
    "-volname",
    productName,
    "-srcfolder",
    stagingDir,
    "-format",
    "UDZO",
    "-imagekey",
    "zlib-level=9",
    "-ov",
    dmgPath,
  ],
  { stdio: "inherit" },
);

rmSync(stagingDir, { recursive: true, force: true });

const dmgStat = statSync(dmgPath);
if (!dmgStat.isFile() || dmgStat.size === 0) {
  console.error(`DMG was not created correctly: ${dmgPath}`);
  process.exit(1);
}

console.log(`Internal smoke DMG created: ${dmgPath}`);
