import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath
} from "node:fs/promises";
import { constants } from "node:fs";
import {
  isAbsolute,
  join,
  normalize,
  relative,
  resolve
} from "node:path";
import {
  defaultPetdexCapabilities,
  defaultRuntimeLimits,
  type PartnerCapabilities
} from "@ai-partner/resolver";
import { type AnimationRef } from "@ai-partner/contracts";
import {
  PETDEX_ATLAS_HEIGHT,
  PETDEX_ATLAS_WIDTH,
  PETDEX_CELL_HEIGHT,
  PETDEX_CELL_WIDTH
} from "./petdex";
import {
  ANIMATIONS_MANIFEST_SCHEMA_VERSION,
  isAnimationRef,
  type AnimationManifestEntry,
  type AnimationsManifest,
  type PetJson
} from "./manifest";
import {
  readImageMetadata,
  type ImageMetadata,
  type ImageMetadataReader
} from "./imageMetadata";

export type AssetValidationErrorCode =
  | "root_missing"
  | "pet_json_missing"
  | "pet_json_invalid"
  | "spritesheet_missing"
  | "bad_atlas_size"
  | "bad_cell_size"
  | "manifest_invalid"
  | "path_escape"
  | "path_absolute"
  | "path_symlink"
  | "runtime_budget";

export interface AssetValidationErrorItem {
  code: AssetValidationErrorCode;
  message: string;
  path?: string;
}

export interface AssetValidationResult {
  ok: boolean;
  root: string;
  petJson?: PetJson;
  manifest?: AnimationsManifest;
  spritesheet?: {
    path: string;
    metadata: ImageMetadata;
  };
  errors: AssetValidationErrorItem[];
}

export interface ValidatePartnerAssetOptions {
  readImageMetadata?: ImageMetadataReader;
}

export class AssetValidationError extends Error {
  constructor(readonly result: AssetValidationResult) {
    super(result.errors.map((error) => `${error.code}: ${error.message}`).join("; "));
    this.name = "AssetValidationError";
  }
}

export async function validatePartnerAsset(
  root: string,
  options: ValidatePartnerAssetOptions = {}
): Promise<AssetValidationResult> {
  const errors: AssetValidationErrorItem[] = [];
  const rootPath = await resolveRoot(root, errors);
  const result: AssetValidationResult = {
    ok: false,
    root: rootPath,
    errors
  };
  if (errors.length > 0) {
    return result;
  }

  const petJson = await readPetJson(rootPath, errors);
  if (!petJson) {
    result.ok = false;
    return result;
  }
  result.petJson = petJson;

  const spritesheetPath = await resolveRelativeAssetPath(
    rootPath,
    petJson.spritesheetPath,
    "spritesheet",
    errors
  );
  if (spritesheetPath) {
    const metadata = await readSpritesheetMetadata(
      spritesheetPath,
      options.readImageMetadata ?? readImageMetadata,
      errors
    );
    if (metadata) {
      result.spritesheet = {
        path: spritesheetPath,
        metadata
      };
    }
  }

  const manifest = await readAnimationsManifest(rootPath, errors);
  if (manifest) {
    result.manifest = manifest;
    await validateAnimationsManifest(
      rootPath,
      manifest,
      options.readImageMetadata ?? readImageMetadata,
      errors
    );
  }

  result.ok = errors.length === 0;
  return result;
}

export interface LoadPartnerCapabilitiesOptions extends ValidatePartnerAssetOptions {
  fallbackOnError?: boolean;
}

export async function loadPartnerCapabilities(
  root: string,
  options: LoadPartnerCapabilitiesOptions = {}
): Promise<PartnerCapabilities> {
  const result = await validatePartnerAsset(root, options);
  if (!result.ok) {
    if (options.fallbackOnError === false) {
      throw new AssetValidationError(result);
    }
    return defaultPetdexCapabilities;
  }

  return capabilitiesFromValidation(result);
}

export async function scanAssetsRoot(root: string): Promise<string[]> {
  const rootPath = await realpath(root);
  const candidates = new Set<string>();

  if (await fileExists(join(rootPath, "pet.json"))) {
    candidates.add(rootPath);
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const candidate = join(rootPath, entry.name);
    if (await fileExists(join(candidate, "pet.json"))) {
      candidates.add(candidate);
    }
  }

  return [...candidates].sort();
}

async function resolveRoot(
  root: string,
  errors: AssetValidationErrorItem[]
): Promise<string> {
  try {
    const originalStat = await lstat(root);
    if (originalStat.isSymbolicLink()) {
      errors.push({
        code: "path_symlink",
        message: "asset root cannot be a symlink",
        path: root
      });
    }
    const rootPath = await realpath(root);
    const stat = await lstat(rootPath);
    if (!stat.isDirectory()) {
      errors.push({
        code: "root_missing",
        message: "asset root is not a directory",
        path: root
      });
    }
    return rootPath;
  } catch {
    errors.push({
      code: "root_missing",
      message: "asset root is missing",
      path: root
    });
    return resolve(root);
  }
}

async function readPetJson(
  root: string,
  errors: AssetValidationErrorItem[]
): Promise<PetJson | undefined> {
  const path = join(root, "pet.json");
  const payload = await readJson(path, "pet_json_missing", errors);
  if (payload === undefined) {
    return undefined;
  }
  if (!isRecord(payload)) {
    errors.push({ code: "pet_json_invalid", message: "pet.json must be an object", path });
    return undefined;
  }
  if (!isNonEmptyString(payload.id) || !isNonEmptyString(payload.spritesheetPath)) {
    errors.push({
      code: "pet_json_invalid",
      message: "pet.json requires id and spritesheetPath strings",
      path
    });
    return undefined;
  }

  return {
    id: payload.id,
    displayName: isNonEmptyString(payload.displayName) ? payload.displayName : undefined,
    description: isNonEmptyString(payload.description) ? payload.description : undefined,
    spritesheetPath: payload.spritesheetPath
  };
}

async function readAnimationsManifest(
  root: string,
  errors: AssetValidationErrorItem[]
): Promise<AnimationsManifest | undefined> {
  const path = join(root, "ai-partner.animations.json");
  if (!(await fileExists(path))) {
    return undefined;
  }

  const payload = await readJson(path, "manifest_invalid", errors);
  if (payload === undefined) {
    return undefined;
  }
  if (!isRecord(payload) || payload.schemaVersion !== ANIMATIONS_MANIFEST_SCHEMA_VERSION) {
    errors.push({
      code: "manifest_invalid",
      message: "animations manifest has an unsupported schemaVersion",
      path
    });
    return undefined;
  }

  const manifest: AnimationsManifest = {
    schemaVersion: ANIMATIONS_MANIFEST_SCHEMA_VERSION
  };

  if (isRecord(payload.baseAsset)) {
    const baseAsset = payload.baseAsset;
    manifest.baseAsset = {};
    if (baseAsset.format !== undefined) {
      if (baseAsset.format !== "petdex") {
        errors.push({
          code: "manifest_invalid",
          message: "baseAsset.format must be petdex",
          path
        });
      } else {
        manifest.baseAsset.format = "petdex";
      }
    }
    if (baseAsset.spritesheetPath !== undefined) {
      if (isNonEmptyString(baseAsset.spritesheetPath)) {
        manifest.baseAsset.spritesheetPath = baseAsset.spritesheetPath;
      } else {
        errors.push({
          code: "manifest_invalid",
          message: "baseAsset.spritesheetPath must be a non-empty string",
          path
        });
      }
    }
    if (baseAsset.cellSize !== undefined && !isRecord(baseAsset.cellSize)) {
      errors.push({
        code: "manifest_invalid",
        message: "baseAsset.cellSize must be an object",
        path
      });
    } else if (isRecord(baseAsset.cellSize)) {
      if (
        typeof baseAsset.cellSize.width !== "number" ||
        typeof baseAsset.cellSize.height !== "number" ||
        !Number.isFinite(baseAsset.cellSize.width) ||
        !Number.isFinite(baseAsset.cellSize.height)
      ) {
        errors.push({
          code: "manifest_invalid",
          message: "baseAsset.cellSize width and height must be numbers",
          path
        });
      } else {
        manifest.baseAsset.cellSize = {
          width: baseAsset.cellSize.width,
          height: baseAsset.cellSize.height
        };
      }
    }
  }

  if (payload.animations !== undefined) {
    if (!isRecord(payload.animations)) {
      errors.push({ code: "manifest_invalid", message: "animations must be an object", path });
    } else {
      manifest.animations = {};
      for (const [animationRef, rawEntry] of Object.entries(payload.animations)) {
        if (!isAnimationRef(animationRef)) {
          errors.push({
            code: "manifest_invalid",
            message: `invalid animation ref: ${animationRef}`,
            path
          });
          continue;
        }
        const entry = parseAnimationEntry(rawEntry, path, errors);
        if (entry) {
          manifest.animations[animationRef] = entry;
        }
      }
    }
  }

  return manifest;
}

function parseAnimationEntry(
  rawEntry: unknown,
  path: string,
  errors: AssetValidationErrorItem[]
): AnimationManifestEntry | undefined {
  if (!isRecord(rawEntry) || !isNonEmptyString(rawEntry.source)) {
    errors.push({
      code: "manifest_invalid",
      message: "animation entries require a source string",
      path
    });
    return undefined;
  }

  const entry: AnimationManifestEntry = {
    source: rawEntry.source
  };
  if (rawEntry.fps !== undefined) {
    if (
      typeof rawEntry.fps !== "number" ||
      !Number.isFinite(rawEntry.fps)
    ) {
      errors.push({
        code: "manifest_invalid",
        message: "animation fps must be a number",
        path
      });
    } else {
      entry.fps = rawEntry.fps;
    }
  }
  if (rawEntry.loop !== undefined) {
    if (typeof rawEntry.loop !== "boolean") {
      errors.push({
        code: "manifest_invalid",
        message: "animation loop must be a boolean",
        path
      });
    } else {
      entry.loop = rawEntry.loop;
    }
  }
  if (Array.isArray(rawEntry.fallbacks)) {
    const fallbacks: AnimationRef[] = [];
    for (const fallback of rawEntry.fallbacks) {
      if (typeof fallback !== "string" || !isAnimationRef(fallback)) {
        errors.push({
          code: "manifest_invalid",
          message: "animation fallbacks must be valid animation refs",
          path
        });
        continue;
      }
      fallbacks.push(fallback);
    }
    entry.fallbacks = fallbacks;
  } else if (rawEntry.fallbacks !== undefined) {
    errors.push({
      code: "manifest_invalid",
      message: "animation fallbacks must be an array",
      path
    });
  }
  return entry;
}

async function validateAnimationsManifest(
  root: string,
  manifest: AnimationsManifest,
  reader: ImageMetadataReader,
  errors: AssetValidationErrorItem[]
): Promise<void> {
  if (manifest.baseAsset?.cellSize) {
    const { width, height } = manifest.baseAsset.cellSize;
    if (width !== PETDEX_CELL_WIDTH || height !== PETDEX_CELL_HEIGHT) {
      errors.push({
        code: "bad_cell_size",
        message: `Petdex cell must be ${PETDEX_CELL_WIDTH}x${PETDEX_CELL_HEIGHT}`
      });
    }
  }
  if (manifest.baseAsset?.spritesheetPath) {
    await resolveRelativeAssetPath(
      root,
      manifest.baseAsset.spritesheetPath,
      "manifest base spritesheet",
      errors
    );
  }

  for (const [animationRef, entry] of Object.entries(manifest.animations ?? {})) {
    const sourcePath = await resolveRelativeAssetPath(
      root,
      entry.source,
      `animation ${animationRef}`,
      errors,
      { expectDirectory: true }
    );
    if (!sourcePath) {
      continue;
    }
    if (entry.fps !== undefined) {
      if (
        !Number.isInteger(entry.fps) ||
        entry.fps < defaultRuntimeLimits.minFps ||
        entry.fps > defaultRuntimeLimits.maxFps
      ) {
        errors.push({
          code: "runtime_budget",
          message: `fps must be ${defaultRuntimeLimits.minFps}-${defaultRuntimeLimits.maxFps}`,
          path: sourcePath
        });
      }
    }
    const frameNames = (await readdir(sourcePath)).filter((name) => /\.png$/i.test(name));
    await validateFramePaths(root, sourcePath, frameNames, reader, errors);
    if (
      frameNames.length === 0 ||
      frameNames.length > defaultRuntimeLimits.maxFramesPerAnimation
    ) {
      errors.push({
        code: "runtime_budget",
        message: `animation must contain 1-${defaultRuntimeLimits.maxFramesPerAnimation} PNG frames`,
        path: sourcePath
      });
    }
  }
}

async function validateFramePaths(
  root: string,
  sourcePath: string,
  frameNames: string[],
  reader: ImageMetadataReader,
  errors: AssetValidationErrorItem[]
): Promise<void> {
  for (const frameName of frameNames) {
    const framePath = join(sourcePath, frameName);
    try {
      const frameStat = await lstat(framePath);
      if (frameStat.isSymbolicLink()) {
        errors.push({
          code: "path_symlink",
          message: "extension frame path cannot be a symlink",
          path: framePath
        });
        continue;
      }
      if (!frameStat.isFile()) {
        errors.push({
          code: "runtime_budget",
          message: "extension frame path must be a PNG file",
          path: framePath
        });
        continue;
      }
      const frameRealPath = await realpath(framePath);
      if (!isPathInside(root, frameRealPath)) {
        errors.push({
          code: "path_escape",
          message: "extension frame path resolves outside companion root",
          path: framePath
        });
        continue;
      }
      try {
        const metadata = await reader(framePath);
        if (
          metadata.width !== defaultRuntimeLimits.frameWidth ||
          metadata.height !== defaultRuntimeLimits.frameHeight
        ) {
          errors.push({
            code: "runtime_budget",
            message: `extension frame must be ${defaultRuntimeLimits.frameWidth}x${defaultRuntimeLimits.frameHeight}`,
            path: framePath
          });
        }
      } catch (error) {
        errors.push({
          code: "runtime_budget",
          message: String(error),
          path: framePath
        });
      }
    } catch {
      errors.push({
        code: "path_escape",
        message: "extension frame path is missing",
        path: framePath
      });
    }
  }
}

async function resolveRelativeAssetPath(
  root: string,
  candidate: string,
  label: string,
  errors: AssetValidationErrorItem[],
  options: { expectDirectory?: boolean } = {}
): Promise<string | undefined> {
  if (isAbsolute(candidate)) {
    errors.push({
      code: "path_absolute",
      message: `${label} path must be relative`,
      path: candidate
    });
    return undefined;
  }
  const normalized = normalize(candidate);
  if (
    normalized === "." ||
    normalized.startsWith("..") ||
    normalized.split(/[\\/]/).includes("..")
  ) {
    errors.push({
      code: "path_escape",
      message: `${label} path cannot escape companion root`,
      path: candidate
    });
    return undefined;
  }

  const fullPath = resolve(root, normalized);
  if (!isPathInside(root, fullPath)) {
    errors.push({
      code: "path_escape",
      message: `${label} path resolves outside companion root`,
      path: candidate
    });
    return undefined;
  }

  try {
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink()) {
      errors.push({
        code: "path_symlink",
        message: `${label} path cannot be a symlink`,
        path: candidate
      });
      return undefined;
    }
    if (options.expectDirectory && !stat.isDirectory()) {
      errors.push({
        code: "path_escape",
        message: `${label} path must be a directory`,
        path: candidate
      });
      return undefined;
    }
    if (!options.expectDirectory && !stat.isFile()) {
      errors.push({
        code: "spritesheet_missing",
        message: `${label} path must be a file`,
        path: candidate
      });
      return undefined;
    }
    const resolvedRealPath = await realpath(fullPath);
    if (!isPathInside(root, resolvedRealPath)) {
      errors.push({
        code: "path_escape",
        message: `${label} symlink target escapes companion root`,
        path: candidate
      });
      return undefined;
    }
    return fullPath;
  } catch {
    errors.push({
      code: options.expectDirectory ? "path_escape" : "spritesheet_missing",
      message: `${label} path is missing`,
      path: candidate
    });
    return undefined;
  }
}

async function readSpritesheetMetadata(
  path: string,
  reader: ImageMetadataReader,
  errors: AssetValidationErrorItem[]
): Promise<ImageMetadata | undefined> {
  try {
    const metadata = await reader(path);
    if (metadata.width !== PETDEX_ATLAS_WIDTH || metadata.height !== PETDEX_ATLAS_HEIGHT) {
      errors.push({
        code: "bad_atlas_size",
        message: `Petdex atlas must be ${PETDEX_ATLAS_WIDTH}x${PETDEX_ATLAS_HEIGHT}`,
        path
      });
    }
    return metadata;
  } catch (error) {
    errors.push({
      code: "bad_atlas_size",
      message: String(error),
      path
    });
    return undefined;
  }
}

async function readJson(
  path: string,
  missingCode: AssetValidationErrorCode,
  errors: AssetValidationErrorItem[]
): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    errors.push({
      code: missingCode,
      message: String(error),
      path
    });
    return undefined;
  }
}

function capabilitiesFromValidation(result: AssetValidationResult): PartnerCapabilities {
  const animations = { ...defaultPetdexCapabilities.animations };
  const fallbacks = { ...defaultPetdexCapabilities.fallbacks };
  for (const [animationRef, entry] of Object.entries(result.manifest?.animations ?? {})) {
    const animation = animationRef as AnimationRef;
    animations[animation] = {
      animation,
      loop: entry.loop ?? defaultLoopFor(animation),
      procedural: []
    };
    if (entry.fallbacks && entry.fallbacks.length > 0) {
      fallbacks[animation] = entry.fallbacks;
    }
  }

  return {
    partnerId: result.petJson?.id ?? defaultPetdexCapabilities.partnerId,
    animations,
    fallbacks,
    runtimeLimits: defaultRuntimeLimits
  };
}

function defaultLoopFor(animation: string): boolean {
  return animation !== "workflow.done" && animation !== "physical.falling";
}

function isPathInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function ensureAssetFixtureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
