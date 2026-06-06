#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const checks = [];

function addCheck(name, pass, detail) {
  checks.push({ name, pass, detail });
}

const scripts = packageJson.scripts ?? {};
addCheck(
  "root tauri build script",
  scripts["tauri:build"] === "pnpm exec tauri build --config src-tauri/tauri.conf.json",
  "pnpm tauri:build uses the checked Tauri config",
);
addCheck(
  "root DMG package script",
  scripts["package:dmg"] === "pnpm run smoke:dmg:preflight && pnpm run tauri:build",
  "pnpm package:dmg runs preflight before building",
);

const build = tauriConfig.build ?? {};
addCheck(
  "frontend build command",
  build.beforeBuildCommand === "pnpm --filter @ai-partner/frontend build",
  "Tauri packages the typed frontend build",
);
addCheck(
  "frontend dist path",
  build.frontendDist === "../frontend/dist",
  "Tauri reads frontend/dist from the workspace package",
);

const bundle = tauriConfig.bundle ?? {};
addCheck("bundle enabled", bundle.active === true, "Tauri bundle.active is true");
addCheck(
  "DMG target enabled",
  Array.isArray(bundle.targets) && bundle.targets.includes("dmg"),
  "bundle.targets includes dmg",
);

const app = tauriConfig.app ?? {};
const mainWindow = (app.windows ?? []).find((window) => window.label === "main");
addCheck("main window configured", Boolean(mainWindow), "window label main exists");
if (mainWindow) {
  addCheck("default window size", mainWindow.width === 520 && mainWindow.height === 360, "520x360 M0/M5 smoke baseline");
  addCheck("transparent frameless window", mainWindow.transparent === true && mainWindow.decorations === false, "transparent + no decorations");
  addCheck("default partner visible", mainWindow.url === "index.html" && mainWindow.backgroundColor === "#00000000", "packaged app loads index.html");
  addCheck("always on top", mainWindow.alwaysOnTop === true, "companion stays visible above normal desktop windows");
  addCheck("no focus stealing", mainWindow.focus === false && mainWindow.focusable === false, "packaged first launch should not take input focus");
  addCheck("ordinary spaces default", mainWindow.visibleOnAllWorkspaces === false, "M0 keeps fullscreen Spaces undisturbed");
}

addCheck(
  "M0 capability selected",
  Array.isArray(app.security?.capabilities) && app.security.capabilities.includes("m0-window-spike"),
  "packaged app keeps the audited M0 permissions set",
);
addCheck("frontend entry exists", existsSync(join(root, "frontend/index.html")), "frontend/index.html is present");

const failed = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`${check.pass ? "ok" : "not ok"} - ${check.name}: ${check.detail}`);
}

if (failed.length > 0) {
  console.error(`\nM5 macOS package preflight failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nM5 macOS package preflight passed. Run pnpm package:dmg for the build, then complete the manual DMG smoke checklist.");
