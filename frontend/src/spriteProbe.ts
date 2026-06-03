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

export interface SpriteFrame {
  row: PetdexRow;
  rowIndex: number;
  columnIndex: number;
  width: number;
  height: number;
  backgroundSize: string;
  backgroundPosition: string;
}

export function spriteFrame(row: PetdexRow, columnIndex: number): SpriteFrame {
  const rowIndex = petdexRows.indexOf(row);
  if (rowIndex < 0) {
    throw new Error(`Unknown Petdex row: ${row}`);
  }
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= PETDEX_COLUMNS) {
    throw new Error(`Sprite column must be 0-${PETDEX_COLUMNS - 1}: ${columnIndex}`);
  }

  return {
    row,
    rowIndex,
    columnIndex,
    width: PETDEX_CELL_WIDTH,
    height: PETDEX_CELL_HEIGHT,
    backgroundSize: `${PETDEX_ATLAS_WIDTH}px ${PETDEX_ATLAS_HEIGHT}px`,
    backgroundPosition: `-${columnIndex * PETDEX_CELL_WIDTH}px -${
      rowIndex * PETDEX_CELL_HEIGHT
    }px`
  };
}

export function buildProbeAtlasDataUrl(): string {
  const cells = petdexRows.flatMap((row, rowIndex) =>
    Array.from({ length: PETDEX_COLUMNS }, (_, columnIndex) => {
      const x = columnIndex * PETDEX_CELL_WIDTH;
      const y = rowIndex * PETDEX_CELL_HEIGHT;
      const hue = (rowIndex * 37 + columnIndex * 19) % 360;
      return [
        `<rect x="${x + 4}" y="${y + 4}" width="${PETDEX_CELL_WIDTH - 8}" height="${
          PETDEX_CELL_HEIGHT - 8
        }" fill="hsl(${hue} 64% 52% / 0.78)" rx="0"/>`,
        `<rect x="${x + 4}" y="${y + 4}" width="${PETDEX_CELL_WIDTH - 8}" height="${
          PETDEX_CELL_HEIGHT - 8
        }" fill="none" stroke="black" stroke-width="2"/>`,
        `<text x="${x + 12}" y="${y + 28}" font-size="16" font-family="monospace" fill="black">${row}:${columnIndex}</text>`
      ].join("");
    })
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PETDEX_ATLAS_WIDTH}" height="${PETDEX_ATLAS_HEIGHT}" viewBox="0 0 ${PETDEX_ATLAS_WIDTH} ${PETDEX_ATLAS_HEIGHT}">${cells.join(
    ""
  )}</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
