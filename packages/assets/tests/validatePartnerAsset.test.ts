import {
  mkdtemp,
  realpath,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PETDEX_ATLAS_HEIGHT,
  PETDEX_ATLAS_WIDTH,
  PETDEX_CELL_HEIGHT,
  PETDEX_CELL_WIDTH
} from "../src";
import {
  ensureAssetFixtureDir,
  loadPartnerCapabilities,
  scanAssetsRoot,
  validatePartnerAsset,
  type ImageMetadataReader
} from "../src/node";

const validMetadata: ImageMetadataReader = async () => ({
  width: PETDEX_ATLAS_WIDTH,
  height: PETDEX_ATLAS_HEIGHT
});

const validPetdexMetadata: ImageMetadataReader = async (filePath) =>
  filePath.toLowerCase().endsWith(".png")
    ? {
        width: PETDEX_CELL_WIDTH,
        height: PETDEX_CELL_HEIGHT
      }
    : {
        width: PETDEX_ATLAS_WIDTH,
        height: PETDEX_ATLAS_HEIGHT
      };

async function makePartnerRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ai-partner-asset-"));
  await writeFile(
    join(root, "pet.json"),
    JSON.stringify({
      id: "fixture-partner",
      displayName: "Fixture Partner",
      spritesheetPath: "spritesheet.webp"
    })
  );
  await writeFile(join(root, "spritesheet.webp"), "");
  return root;
}

async function writeManifest(root: string, manifest: unknown) {
  await writeFile(join(root, "ai-partner.animations.json"), JSON.stringify(manifest));
}

describe("validatePartnerAsset", () => {
  it("accepts a basic Petdex-compatible pet.json and spritesheet", async () => {
    const root = await makePartnerRoot();
    const result = await validatePartnerAsset(root, { readImageMetadata: validPetdexMetadata });
    const capabilities = await loadPartnerCapabilities(root, {
      readImageMetadata: validPetdexMetadata
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(capabilities.partnerId).toBe("fixture-partner");
    expect(capabilities.animations["legacy.review"]).toMatchObject({
      animation: "legacy.review"
    });
  });

  it("rejects a missing pet.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-partner-asset-missing-"));
    const result = await validatePartnerAsset(root, { readImageMetadata: validPetdexMetadata });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "pet_json_missing"
      })
    );
  });

  it("rejects wrong Petdex atlas dimensions", async () => {
    const root = await makePartnerRoot();
    const result = await validatePartnerAsset(root, {
      readImageMetadata: async () => ({ width: 100, height: 100 })
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "bad_atlas_size" }));
  });

  it("rejects wrong manifest cell dimensions", async () => {
    const root = await makePartnerRoot();
    await writeManifest(root, {
      schemaVersion: "ai-partner.animations.v1",
      baseAsset: {
        format: "petdex",
        cellSize: {
          width: PETDEX_CELL_WIDTH - 1,
          height: PETDEX_CELL_HEIGHT
        }
      }
    });

    const result = await validatePartnerAsset(root, { readImageMetadata: validPetdexMetadata });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "bad_cell_size" }));
  });

  it("validates optional manifest base spritesheet paths through the sandbox", async () => {
    const root = await makePartnerRoot();
    await writeManifest(root, {
      schemaVersion: "ai-partner.animations.v1",
      baseAsset: {
        format: "petdex",
        spritesheetPath: "../spritesheet.webp",
        cellSize: {
          width: PETDEX_CELL_WIDTH,
          height: PETDEX_CELL_HEIGHT
        }
      }
    });

    const result = await validatePartnerAsset(root, { readImageMetadata: validPetdexMetadata });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "path_escape" }));
  });

  it("rejects loose manifest field types instead of coercing them", async () => {
    const root = await makePartnerRoot();
    const source = join(root, "extras", "workflow-done");
    await ensureAssetFixtureDir(source);
    await writeFile(join(source, "000.png"), "");
    await writeManifest(root, {
      schemaVersion: "ai-partner.animations.v1",
      baseAsset: {
        format: "petdex",
        cellSize: {
          width: "192",
          height: PETDEX_CELL_HEIGHT
        }
      },
      animations: {
        "workflow.done": {
          source: "extras/workflow-done",
          fps: "8",
          loop: "false",
          fallbacks: ["legacy.waving", "not-a-ref"]
        }
      }
    });

    const result = await validatePartnerAsset(root, { readImageMetadata: validMetadata });

    expect(result.ok).toBe(false);
    expect(result.errors.filter((error) => error.code === "manifest_invalid")).toHaveLength(4);
  });

  it("rejects path traversal and absolute spritesheet paths", async () => {
    const traversalRoot = await makePartnerRoot();
    await writeFile(
      join(traversalRoot, "pet.json"),
      JSON.stringify({
        id: "bad-traversal",
        spritesheetPath: "../spritesheet.webp"
      })
    );
    const traversal = await validatePartnerAsset(traversalRoot, {
      readImageMetadata: validPetdexMetadata
    });

    const absoluteRoot = await makePartnerRoot();
    await writeFile(
      join(absoluteRoot, "pet.json"),
      JSON.stringify({
        id: "bad-absolute",
        spritesheetPath: "/tmp/spritesheet.webp"
      })
    );
    const absolute = await validatePartnerAsset(absoluteRoot, {
      readImageMetadata: validPetdexMetadata
    });

    expect(traversal.errors).toContainEqual(expect.objectContaining({ code: "path_escape" }));
    expect(absolute.errors).toContainEqual(expect.objectContaining({ code: "path_absolute" }));
  });

  it("rejects spritesheet symlinks", async () => {
    const root = await makePartnerRoot();
    const outside = join(await mkdtemp(join(tmpdir(), "ai-partner-asset-outside-")), "out.webp");
    await writeFile(outside, "");
    await writeFile(
      join(root, "pet.json"),
      JSON.stringify({
        id: "bad-symlink",
        spritesheetPath: "linked.webp"
      })
    );
    await symlink(outside, join(root, "linked.webp"));

    const result = await validatePartnerAsset(root, { readImageMetadata: validPetdexMetadata });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "path_symlink" }));
  });

  it("rejects asset roots that are symlinks", async () => {
    const root = await makePartnerRoot();
    const linkedRoot = join(
      await mkdtemp(join(tmpdir(), "ai-partner-linked-root-parent-")),
      "linked-root"
    );
    await symlink(root, linkedRoot);

    const result = await validatePartnerAsset(linkedRoot, { readImageMetadata: validPetdexMetadata });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "path_symlink" }));
  });

  it("rejects extension frame symlinks", async () => {
    const root = await makePartnerRoot();
    const source = join(root, "extras", "workflow-done");
    await ensureAssetFixtureDir(source);
    const outside = join(await mkdtemp(join(tmpdir(), "ai-partner-frame-outside-")), "000.png");
    await writeFile(outside, "");
    await symlink(outside, join(source, "000.png"));
    await writeManifest(root, {
      schemaVersion: "ai-partner.animations.v1",
      animations: {
        "workflow.done": {
          source: "extras/workflow-done",
          fps: 8,
          loop: false
        }
      }
    });

    const result = await validatePartnerAsset(root, { readImageMetadata: validPetdexMetadata });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "path_symlink" }));
  });

  it("rejects extension frames with wrong runtime dimensions", async () => {
    const root = await makePartnerRoot();
    const source = join(root, "extras", "workflow-done");
    await ensureAssetFixtureDir(source);
    await writeFile(join(source, "000.png"), "");
    await writeManifest(root, {
      schemaVersion: "ai-partner.animations.v1",
      animations: {
        "workflow.done": {
          source: "extras/workflow-done",
          fps: 8,
          loop: false
        }
      }
    });

    const result = await validatePartnerAsset(root, {
      readImageMetadata: async (filePath) =>
        filePath.toLowerCase().endsWith(".png")
          ? { width: PETDEX_CELL_WIDTH + 1, height: PETDEX_CELL_HEIGHT }
          : { width: PETDEX_ATLAS_WIDTH, height: PETDEX_ATLAS_HEIGHT }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "runtime_budget" }));
  });

  it("rejects extension frame directory entries that look like PNGs", async () => {
    const root = await makePartnerRoot();
    const source = join(root, "extras", "workflow-done");
    await ensureAssetFixtureDir(join(source, "000.png"));
    await writeManifest(root, {
      schemaVersion: "ai-partner.animations.v1",
      animations: {
        "workflow.done": {
          source: "extras/workflow-done",
          fps: 8,
          loop: false
        }
      }
    });

    const result = await validatePartnerAsset(root, { readImageMetadata: validPetdexMetadata });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "runtime_budget" }));
  });

  it("rejects extension animations over frame and fps budgets", async () => {
    const root = await makePartnerRoot();
    const source = join(root, "extras", "workflow-done");
    await ensureAssetFixtureDir(source);
    for (let index = 0; index < 33; index += 1) {
      await writeFile(join(source, `${String(index).padStart(3, "0")}.png`), "");
    }
    await writeManifest(root, {
      schemaVersion: "ai-partner.animations.v1",
      animations: {
        "workflow.done": {
          source: "extras/workflow-done",
          fps: 25,
          loop: false
        }
      }
    });

    const result = await validatePartnerAsset(root, { readImageMetadata: validPetdexMetadata });

    expect(result.ok).toBe(false);
    expect(result.errors.filter((error) => error.code === "runtime_budget")).toHaveLength(2);
  });

  it("loads extension animations and fallbacks into PartnerCapabilities", async () => {
    const root = await makePartnerRoot();
    const source = join(root, "extras", "workflow-done");
    await ensureAssetFixtureDir(source);
    await writeFile(join(source, "000.png"), "");
    await writeManifest(root, {
      schemaVersion: "ai-partner.animations.v1",
      animations: {
        "workflow.done": {
          source: "extras/workflow-done",
          fps: 8,
          loop: false,
          fallbacks: ["legacy.waving", "legacy.jumping"]
        }
      }
    });

    const capabilities = await loadPartnerCapabilities(root, {
      readImageMetadata: validPetdexMetadata
    });

    expect(capabilities.animations["workflow.done"]).toEqual({
      animation: "workflow.done",
      loop: false,
      procedural: []
    });
    expect(capabilities.fallbacks["workflow.done"]).toEqual([
      "legacy.waving",
      "legacy.jumping"
    ]);
  });

  it("falls back to the default Petdex partner for invalid assets unless strict mode is requested", async () => {
    const root = await makePartnerRoot();
    const fallback = await loadPartnerCapabilities(root, {
      readImageMetadata: async () => ({ width: 1, height: 1 })
    });

    expect(fallback.partnerId).toBe("default-petdex");
    await expect(
      loadPartnerCapabilities(root, {
        fallbackOnError: false,
        readImageMetadata: async () => ({ width: 1, height: 1 })
      })
    ).rejects.toMatchObject({
      name: "AssetValidationError"
    });
  });

  it("scans one assets root for direct Petdex partner directories", async () => {
    const assetsRoot = await mkdtemp(join(tmpdir(), "ai-partner-assets-root-"));
    const partnerA = join(assetsRoot, "partner-a");
    const partnerB = join(assetsRoot, "partner-b");
    await ensureAssetFixtureDir(partnerA);
    await ensureAssetFixtureDir(partnerB);
    await writeFile(join(partnerA, "pet.json"), "{}");
    await writeFile(join(partnerB, "pet.json"), "{}");

    await expect(scanAssetsRoot(assetsRoot)).resolves.toEqual([
      await realpath(partnerA),
      await realpath(partnerB)
    ]);
  });
});
