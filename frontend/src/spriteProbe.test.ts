import { describe, expect, it } from "vitest";
import {
  PETDEX_ATLAS_HEIGHT,
  PETDEX_ATLAS_WIDTH,
  PETDEX_CELL_HEIGHT,
  PETDEX_CELL_WIDTH,
  spriteFrame
} from "./spriteProbe";

describe("CSS sprite frame alignment probe", () => {
  it("uses the Petdex 192x208 cell and 1536x1872 atlas contract", () => {
    expect(PETDEX_CELL_WIDTH).toBe(192);
    expect(PETDEX_CELL_HEIGHT).toBe(208);
    expect(PETDEX_ATLAS_WIDTH).toBe(1536);
    expect(PETDEX_ATLAS_HEIGHT).toBe(1872);
  });

  it("aligns the review row frame without fractional offsets", () => {
    expect(spriteFrame("review", 3)).toEqual({
      row: "review",
      rowIndex: 8,
      columnIndex: 3,
      width: 192,
      height: 208,
      backgroundSize: "1536px 1872px",
      backgroundPosition: "-576px -1664px"
    });
  });

  it("rejects out-of-range columns before rendering", () => {
    expect(() => spriteFrame("idle", 8)).toThrow("Sprite column must be 0-7");
  });
});
