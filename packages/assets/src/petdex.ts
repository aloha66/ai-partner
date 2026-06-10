import { type AnimationRef } from "@ai-partner/contracts";

export const PETDEX_COLUMNS = 8;
export const PETDEX_ROWS = 9;
export const PETDEX_CELL_WIDTH = 192;
export const PETDEX_CELL_HEIGHT = 208;
export const PETDEX_ATLAS_WIDTH = PETDEX_COLUMNS * PETDEX_CELL_WIDTH;
export const PETDEX_ATLAS_HEIGHT = PETDEX_ROWS * PETDEX_CELL_HEIGHT;

export type PetdexRow =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export const petdexRows: PetdexRow[] = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review"
];

export const petdexFrameCounts: Record<PetdexRow, number> = {
  idle: 6,
  "running-right": 8,
  "running-left": 8,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6
};

export const legacyAnimationByPetdexRow: Record<PetdexRow, AnimationRef> = {
  idle: "legacy.idle",
  "running-right": "legacy.running-right",
  "running-left": "legacy.running-left",
  waving: "legacy.waving",
  jumping: "legacy.jumping",
  failed: "legacy.failed",
  waiting: "legacy.waiting",
  running: "legacy.running",
  review: "legacy.review"
};
