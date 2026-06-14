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
  "root Tauri app bundle script",
  scripts["tauri:build:app"] === "pnpm exec tauri build --config src-tauri/tauri.conf.json --bundles app",
  "pnpm tauri:build:app produces the packaged .app used by the internal DMG smoke artifact",
);
addCheck(
  "root DMG package script",
  scripts["package:dmg"] === "pnpm run smoke:dmg:preflight && pnpm run tauri:build:app && node scripts/package-macos-dmg.mjs",
  "pnpm package:dmg runs preflight, builds the packaged app, then creates the internal DMG",
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
addCheck(
  "asset protocol scoped to local pet roots",
  app.security?.assetProtocol?.enable === true &&
    JSON.stringify(app.security.assetProtocol.scope) ===
      JSON.stringify(["$HOME/.petdex/pets/**", "$HOME/.codex/pets/**"]),
  "runtime atlas URLs are limited to the local Petdex/Codex pets directories",
);
addCheck(
  "CSP limits image sources to bundled/data/asset URLs",
  typeof app.security?.csp === "string" &&
    app.security.csp.includes("img-src 'self' data: asset: http://asset.localhost https://asset.localhost") &&
    !app.security.csp.includes("img-src *"),
  "packaged renderer can load pet atlases without opening arbitrary remote image sources",
);
addCheck("frontend entry exists", existsSync(join(root, "frontend/index.html")), "frontend/index.html is present");
addCheck(
  "internal DMG builder exists",
  existsSync(join(root, "scripts/package-macos-dmg.mjs")),
  "scripts/package-macos-dmg.mjs creates the smoke DMG without Finder AppleScript",
);

const failed = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`${check.pass ? "ok" : "not ok"} - ${check.name}: ${check.detail}`);
}

if (failed.length > 0) {
  console.error(`\nM5 macOS package preflight failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nM5 macOS package preflight passed. Run pnpm package:dmg for the build, then complete the manual DMG smoke checklist.");
