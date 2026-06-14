import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANIMATION_INTENT_SCHEMA_VERSION,
  PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
  type AnimationIntent,
  type AnimationRef,
  type PartnerStateSnapshot
} from "@ai-partner/contracts";
import {
  PETDEX_ATLAS_HEIGHT,
  PETDEX_ATLAS_WIDTH,
  PETDEX_CELL_HEIGHT,
  PETDEX_CELL_WIDTH,
  PETDEX_COLUMNS,
  legacyAnimationByPetdexRow,
  petdexFrameCounts,
  petdexRows,
  type PetdexRow
} from "@ai-partner/assets/petdex";
import { describe, expect, it } from "vitest";
import { resolvePartnerIntent } from "./animationIntentView";
import {
  SPRITE_RENDER_HEIGHT,
  SPRITE_RENDER_WIDTH,
  normalizeSpriteColumnForRow,
  spriteRenderModelForIntent
} from "./spriteRenderer";

const expectedArtoriaRoots = [
  join(homedir(), ".petdex/pets/artoria"),
  join(homedir(), ".codex/pets/artoria")
];

const stylesPath = fileURLToPath(new URL("./styles.css", import.meta.url));
const styles = readFileSync(stylesPath, "utf8");
const anyArtoriaRootExists = expectedArtoriaRoots.some((root) => existsSync(root));
const describeRealArtoria = anyArtoriaRootExists ? describe : describe.skip;
const contactSheetOutputPath = process.env.AI_PARTNER_PETDEX_CONTACT_SHEET_PATH?.trim() ||
  (existsSync("/private/tmp")
    ? "/private/tmp/ai-partner-artoria-petdex-contact-sheet.png"
    : join(tmpdir(), "ai-partner-artoria-petdex-contact-sheet.png"));

interface SipsMetadata {
  pixelWidth: number;
  pixelHeight: number;
  hasAlpha: boolean;
}

interface CellReport {
  row: PetdexRow;
  columnIndex: number;
  nonTransparentPixels: number;
  bbox: [number, number, number, number] | null;
}

interface AtlasReport {
  width: number;
  height: number;
  contactSheetPath: string;
  cells: CellReport[];
}

function snapshot(
  workflowState: PartnerStateSnapshot["workflowState"],
  message?: string
): PartnerStateSnapshot {
  return {
    schemaVersion: PARTNER_STATE_SNAPSHOT_SCHEMA_VERSION,
    workflowState,
    runId: "run_artoria_smoke",
    activeRunId: "run_artoria_smoke",
    source: "cli",
    message,
    priority: "normal",
    updatedAt: "2026-06-10T00:00:00Z",
    paused: false,
    connection: "ok"
  };
}

function intentFor(animation: AnimationRef, loop = true): AnimationIntent {
  return {
    schemaVersion: ANIMATION_INTENT_SCHEMA_VERSION,
    body: {
      animation,
      procedural: [],
      loop
    },
    bubble: null,
    queued: []
  };
}

function readSipsMetadata(filePath: string): SipsMetadata {
  const output = execFileSync(
    "sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", filePath],
    { encoding: "utf8" }
  );

  return {
    pixelWidth: Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]),
    pixelHeight: Number(output.match(/pixelHeight:\s*(\d+)/)?.[1]),
    hasAlpha: output.match(/hasAlpha:\s*(\w+)/)?.[1] === "yes"
  };
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function analyzeAtlasWithPillow(spritesheetPath: string, contactSheetPath: string): AtlasReport {
  const script = String.raw`
import json
import sys
from PIL import Image, ImageDraw

sprite_path, contact_sheet_path = sys.argv[1:3]
rows = json.loads(sys.argv[3])
frame_counts = json.loads(sys.argv[4])
cell_width = 192
cell_height = 208
thumb_width = 96
thumb_height = 104
label_width = 128
label_height = 20

image = Image.open(sprite_path).convert("RGBA")
cells = []
for row_index, row in enumerate(rows):
    for column_index in range(8):
        left = column_index * cell_width
        top = row_index * cell_height
        cell = image.crop((left, top, left + cell_width, top + cell_height))
        alpha = cell.getchannel("A")
        histogram = alpha.histogram()
        non_transparent = sum(histogram[1:])
        cells.append({
            "row": row,
            "columnIndex": column_index,
            "nonTransparentPixels": non_transparent,
            "bbox": alpha.getbbox()
        })

sheet = Image.new(
    "RGBA",
    (label_width + 8 * thumb_width, len(rows) * (thumb_height + label_height)),
    (246, 248, 250, 255)
)
draw = ImageDraw.Draw(sheet)
for row_index, row in enumerate(rows):
    y = row_index * (thumb_height + label_height)
    draw.text((6, y + 6), f"{row} ({frame_counts[row]})", fill=(15, 23, 42, 255))
    for column_index in range(8):
        x = label_width + column_index * thumb_width
        source = image.crop((
            column_index * cell_width,
            row_index * cell_height,
            (column_index + 1) * cell_width,
            (row_index + 1) * cell_height
        )).resize((thumb_width, thumb_height), Image.Resampling.NEAREST)
        if column_index >= frame_counts[row]:
            draw.rectangle(
                (x, y + label_height, x + thumb_width - 1, y + label_height + thumb_height - 1),
                fill=(226, 232, 240, 255)
            )
        sheet.alpha_composite(source, (x, y + label_height))
        outline = (14, 165, 233, 255) if column_index < frame_counts[row] else (220, 38, 38, 255)
        draw.rectangle(
            (x, y + label_height, x + thumb_width - 1, y + label_height + thumb_height - 1),
            outline=outline,
            width=2
        )
        draw.text((x + 4, y + 3), str(column_index), fill=(15, 23, 42, 255))

sheet.save(contact_sheet_path)
print(json.dumps({
    "width": image.width,
    "height": image.height,
    "contactSheetPath": contact_sheet_path,
    "cells": cells
}))
`;

  return JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        script,
        spritesheetPath,
        contactSheetPath,
        JSON.stringify(petdexRows),
        JSON.stringify(petdexFrameCounts)
      ],
      { encoding: "utf8" }
    )
  ) as AtlasReport;
}

function cell(report: AtlasReport, row: PetdexRow, columnIndex: number): CellReport {
  const match = report.cells.find(
    (entry) => entry.row === row && entry.columnIndex === columnIndex
  );
  if (!match) {
    throw new Error(`Missing cell report for ${row}:${columnIndex}`);
  }
  return match;
}

describeRealArtoria("Petdex Artoria real asset visual compatibility smoke", () => {
  it("validates both local Artoria roots without committing private assets", () => {
    const hashes = expectedArtoriaRoots.map((root) => {
      const petJsonPath = join(root, "pet.json");
      const spritesheetPath = join(root, "spritesheet.webp");

      expect(existsSync(petJsonPath), `${petJsonPath} should exist`).toBe(true);
      expect(existsSync(spritesheetPath), `${spritesheetPath} should exist`).toBe(true);

      const petJson = JSON.parse(readFileSync(petJsonPath, "utf8")) as {
        id?: string;
        displayName?: string;
        spritesheetPath?: string;
      };
      const metadata = readSipsMetadata(spritesheetPath);

      expect(petJson).toMatchObject({
        id: "artoria",
        displayName: "Artoria",
        spritesheetPath: "spritesheet.webp"
      });
      expect(metadata).toEqual({
        pixelWidth: PETDEX_ATLAS_WIDTH,
        pixelHeight: PETDEX_ATLAS_HEIGHT,
        hasAlpha: true
      });

      return sha256(spritesheetPath);
    });

    expect(new Set(hashes).size).toBe(1);
  });

  it("detects the valid frame count for all 9 Petdex rows and marks padding transparent", () => {
    const spritesheetPath = join(expectedArtoriaRoots[0], "spritesheet.webp");
    const contactSheetPath = contactSheetOutputPath;
    const report = analyzeAtlasWithPillow(spritesheetPath, contactSheetPath);

    expect(report.width).toBe(PETDEX_ATLAS_WIDTH);
    expect(report.height).toBe(PETDEX_ATLAS_HEIGHT);
    expect(existsSync(report.contactSheetPath)).toBe(true);

    for (const row of petdexRows) {
      const expectedFrames = petdexFrameCounts[row];
      for (let columnIndex = 0; columnIndex < PETDEX_COLUMNS; columnIndex += 1) {
        const entry = cell(report, row, columnIndex);
        if (columnIndex < expectedFrames) {
          expect(entry.nonTransparentPixels, `${row}:${columnIndex} should be visible`)
            .toBeGreaterThan(1_000);
          expect(entry.bbox, `${row}:${columnIndex} should have an alpha bbox`).not.toBeNull();
        } else {
          expect(entry.nonTransparentPixels, `${row}:${columnIndex} should be padding`).toBe(0);
          expect(entry.bbox, `${row}:${columnIndex} padding should stay empty`).toBeNull();
        }
      }
    }
  });
});

describe("Full Petdex renderer compatibility smoke", () => {
  it("keeps every Petdex row on valid frames instead of transparent padding", () => {
    for (const row of petdexRows) {
      const animation = legacyAnimationByPetdexRow[row];
      const frameCount = petdexFrameCounts[row];

      for (let frameIndex = 0; frameIndex < PETDEX_COLUMNS * 2; frameIndex += 1) {
        const columnIndex = normalizeSpriteColumnForRow(row, frameIndex);
        const model = spriteRenderModelForIntent(
          intentFor(animation, animation !== "legacy.waving" && animation !== "legacy.jumping"),
          frameIndex,
          "data:image/png;base64,real-atlas"
        );

        expect(columnIndex).toBeLessThan(frameCount);
        expect(model.row).toBe(row);
        expect(model.frame.columnIndex).toBe(columnIndex);
        expect(model.frame.row).toBe(row);
      }
    }
  });

  it("keeps Retina sprite clipping on integer CSS and physical pixels", () => {
    expect(styles).toMatch(/\.sprite-frame\s*\{[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.sprite-frame\s*\{[^}]*image-rendering:\s*pixelated;/s);
    expect(styles).toMatch(/\.sprite-atlas\s*\{[^}]*image-rendering:\s*pixelated;/s);
    expect(SPRITE_RENDER_WIDTH).toBe(173);
    expect(SPRITE_RENDER_HEIGHT).toBe(187);

    for (const row of petdexRows) {
      const model = spriteRenderModelForIntent(
        intentFor(legacyAnimationByPetdexRow[row]),
        petdexFrameCounts[row] - 1,
        "data:image/png;base64,real-atlas"
      );
      const cssWidth = Number(model.style.width);
      const cssHeight = Number(model.style.height);
      const atlasWidth = Number(model.atlasStyle.width);
      const atlasHeight = Number(model.atlasStyle.height);
      const offsetX = model.frame.columnIndex * cssWidth;
      const offsetY = model.frame.rowIndex * cssHeight;

      expect(cssWidth).toBe(SPRITE_RENDER_WIDTH);
      expect(cssHeight).toBe(SPRITE_RENDER_HEIGHT);
      expect(atlasWidth).toBe(SPRITE_RENDER_WIDTH * PETDEX_COLUMNS);
      expect(atlasHeight).toBe(SPRITE_RENDER_HEIGHT * petdexRows.length);
      expect(PETDEX_ATLAS_WIDTH / atlasWidth).toBeCloseTo(PETDEX_ATLAS_HEIGHT / atlasHeight);
      expect(offsetX + cssWidth).toBeLessThanOrEqual(atlasWidth);
      expect(offsetY + cssHeight).toBeLessThanOrEqual(atlasHeight);

      for (const devicePixelRatio of [1, 2]) {
        expect(Number.isInteger(cssWidth * devicePixelRatio)).toBe(true);
        expect(Number.isInteger(cssHeight * devicePixelRatio)).toBe(true);
        expect(Number.isInteger(offsetX * devicePixelRatio)).toBe(true);
        expect(Number.isInteger(offsetY * devicePixelRatio)).toBe(true);
      }
    }
  });

  it("maps workflow states to the expected Petdex rows for the real atlas contract", () => {
    const expectedRows: Record<PartnerStateSnapshot["workflowState"], PetdexRow> = {
      idle: "idle",
      running: "running",
      reading: "review",
      editing: "running",
      waiting: "waiting",
      error: "failed",
      done: "waving"
    };

    for (const [workflowState, expectedRow] of Object.entries(expectedRows) as Array<
      [PartnerStateSnapshot["workflowState"], PetdexRow]
    >) {
      const intent = resolvePartnerIntent(snapshot(workflowState), "normal");
      const model = spriteRenderModelForIntent(intent, petdexFrameCounts[expectedRow] - 1, "atlas");

      expect(model.row).toBe(expectedRow);
      expect(model.frame.columnIndex).toBe(petdexFrameCounts[expectedRow] - 1);
    }
  });

  it("maps physical states to body motion while preserving waiting and error bubbles", () => {
    const physicalRows = {
      carried: "idle",
      struggling: "running-left",
      falling: "idle",
      recovering: "idle"
    } as const;

    for (const workflowState of ["waiting", "error"] as const) {
      for (const [physicalState, expectedRow] of Object.entries(physicalRows)) {
        const intent = resolvePartnerIntent(
          snapshot(workflowState, `${workflowState} priority smoke`),
          physicalState as keyof typeof physicalRows
        );
        const model = spriteRenderModelForIntent(intent, 0, "atlas");

        expect(model.row).toBe(expectedRow);
        expect(intent.bubble).toEqual({
          state: workflowState,
          text: `${workflowState} priority smoke`,
          priority: "high"
        });
      }
    }
  });
});
