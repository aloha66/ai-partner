import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";

const mimeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp"
};

function atlasDataUrlFromPath(atlasPath: string): string {
  const extension = extname(atlasPath).toLowerCase();
  const sourcePath =
    extension === ".webp"
      ? pngAtlasPathForWebKit(atlasPath)
      : atlasPath;
  const mime = mimeByExtension[extname(sourcePath).toLowerCase()] ?? "application/octet-stream";

  return `data:${mime};base64,${readFileSync(sourcePath).toString("base64")}`;
}

function pngAtlasPathForWebKit(atlasPath: string): string {
  const outputPath = join(
    tmpdir(),
    `ai-partner-${basename(atlasPath, extname(atlasPath))}-atlas.png`
  );

  try {
    execFileSync("sips", ["-s", "format", "png", atlasPath, "--out", outputPath], {
      stdio: "ignore"
    });
    return outputPath;
  } catch {
    return atlasPath;
  }
}

const defaultAtlasPath = process.env.VITE_AI_PARTNER_DEFAULT_ATLAS_PATH?.trim();
const defaultAtlasDataUrl = defaultAtlasPath ? atlasDataUrlFromPath(defaultAtlasPath) : "";

if (defaultAtlasDataUrl.length > 0) {
  process.env.VITE_AI_PARTNER_DEFAULT_ATLAS_DATA_URL = defaultAtlasDataUrl;
}

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  }
});
