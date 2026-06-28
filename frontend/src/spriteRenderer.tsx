import { type CSSProperties, type PointerEventHandler } from "react";
import {
  type AnimationFrameSource,
  type AnimationIntent,
  type AnimationRef,
  type ProceduralEffect
} from "@ai-partner/contracts";
import {
  legacyAnimationByPetdexRow,
  PETDEX_COLUMNS,
  PETDEX_CELL_HEIGHT,
  PETDEX_CELL_WIDTH,
  PETDEX_ROWS,
  petdexFrameCounts,
  type PetdexRow
} from "@ai-partner/assets/petdex";
import { spriteFrame, type SpriteFrame } from "./spriteProbe";

export const SPRITE_RENDER_HEIGHT = 187;
export const SPRITE_RENDER_WIDTH = Math.round(
  (PETDEX_CELL_WIDTH / PETDEX_CELL_HEIGHT) * SPRITE_RENDER_HEIGHT
);
export const SPRITE_RENDER_SCALE_X = SPRITE_RENDER_WIDTH / PETDEX_CELL_WIDTH;
export const SPRITE_RENDER_SCALE_Y = SPRITE_RENDER_HEIGHT / PETDEX_CELL_HEIGHT;

const petdexRowByAnimation = {
  ...Object.fromEntries(Object.entries(legacyAnimationByPetdexRow).map(([row, animation]) => [animation, row]))
} as Partial<Record<AnimationRef, PetdexRow>>;

interface SpriteRenderModelBase {
  animation: AnimationRef;
  sourceKind: AnimationFrameSource["kind"];
  className: string;
  style: CSSProperties;
  loop: boolean;
  procedural: ProceduralEffect[];
}

export interface PetdexSpriteRenderModel extends SpriteRenderModelBase {
  sourceKind: "petdex-row";
  row: PetdexRow;
  frame: SpriteFrame;
  atlasKind: "asset" | "url" | "probe";
  atlasUrl: string;
  atlasStyle: CSSProperties;
}

export interface PngSequenceSpriteRenderModel extends SpriteRenderModelBase {
  sourceKind: "png-sequence";
  frameUrl: string;
  frameIndex: number;
  frameCount: number;
  fps: number;
}

export interface MissingSpriteRenderModel extends SpriteRenderModelBase {
  sourceKind: "missing";
}

export type SpriteRenderModel =
  | PetdexSpriteRenderModel
  | PngSequenceSpriteRenderModel
  | MissingSpriteRenderModel;

export interface SpriteRendererProps {
  intent: AnimationIntent;
  frameIndex: number;
  atlasUrl: string;
  onAtlasError?: () => void;
  onFrameSequenceError?: (animation: AnimationRef) => void;
}

export interface PartnerRendererProps extends SpriteRendererProps {
  dragging: boolean;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onLostPointerCapture: PointerEventHandler<HTMLDivElement>;
}

export function petdexRowForAnimation(animation: AnimationRef): PetdexRow {
  const row = petdexRowByAnimation[animation];
  if (row === undefined) {
    throw new Error(`Animation ${animation} does not have a Petdex row source`);
  }
  return row;
}

export function normalizeSpriteColumn(frameIndex: number): number {
  if (!Number.isFinite(frameIndex)) {
    return 0;
  }
  return ((Math.trunc(frameIndex) % PETDEX_COLUMNS) + PETDEX_COLUMNS) % PETDEX_COLUMNS;
}

export function normalizeSpriteColumnForRow(row: PetdexRow, frameIndex: number): number {
  const frameCount = petdexFrameCounts[row] ?? PETDEX_COLUMNS;
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > PETDEX_COLUMNS) {
    return normalizeSpriteColumn(frameIndex);
  }
  return normalizeFrameIndex(frameIndex, frameCount);
}

export function normalizeFrameIndex(frameIndex: number, frameCount: number): number {
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    return 0;
  }
  if (!Number.isFinite(frameIndex)) {
    return 0;
  }
  return ((Math.trunc(frameIndex) % frameCount) + frameCount) % frameCount;
}

function atlasKind(atlasUrl: string): PetdexSpriteRenderModel["atlasKind"] {
  if (atlasUrl.startsWith("asset:") || atlasUrl.includes("://asset.localhost/")) {
    return "asset";
  }
  if (atlasUrl.startsWith("data:image/svg+xml")) {
    return "probe";
  }
  return "url";
}

export function spriteRenderModelForIntent(
  intent: AnimationIntent,
  frameIndex: number,
  atlasUrl: string
): SpriteRenderModel {
  const width = SPRITE_RENDER_WIDTH;
  const height = SPRITE_RENDER_HEIGHT;
  const procedural = [...intent.body.procedural].sort();
  const className = [
    "sprite-frame",
    intent.body.loop ? "is-looping" : "is-once",
    ...procedural.map((effect) => `effect-${effect}`)
  ].join(" ");
  const base = {
    animation: intent.body.animation,
    className,
    loop: intent.body.loop,
    procedural,
    style: {
      width,
      height
    }
  };

  if (intent.body.source.kind === "png-sequence") {
    const frames = intent.body.source.frames;
    const normalizedFrameIndex = normalizePngSequenceFrameIndex(
      frameIndex,
      frames.length,
      intent.body.loop
    );
    return {
      ...base,
      sourceKind: "png-sequence",
      frameUrl: frames[normalizedFrameIndex] ?? "",
      frameIndex: normalizedFrameIndex,
      frameCount: frames.length,
      fps: intent.body.source.fps
    };
  }

  if (intent.body.source.kind === "missing") {
    return {
      ...base,
      sourceKind: "missing"
    };
  }

  const row = intent.body.source.row;
  const normalizedColumn = normalizeFrameIndex(frameIndex, intent.body.source.frameCount);
  const frame = spriteFrame(row, normalizedColumn);

  return {
    ...base,
    sourceKind: "petdex-row",
    row,
    frame,
    atlasKind: atlasKind(atlasUrl),
    atlasUrl,
    atlasStyle: {
      width: SPRITE_RENDER_WIDTH * PETDEX_COLUMNS,
      height: SPRITE_RENDER_HEIGHT * PETDEX_ROWS,
      transform: `translate3d(-${frame.columnIndex * width}px, -${frame.rowIndex * height}px, 0)`
    }
  };
}

function normalizePngSequenceFrameIndex(
  frameIndex: number,
  frameCount: number,
  loop: boolean
): number {
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    return 0;
  }
  if (!Number.isFinite(frameIndex)) {
    return 0;
  }
  const index = Math.trunc(frameIndex);
  if (loop) {
    return ((index % frameCount) + frameCount) % frameCount;
  }
  return Math.min(Math.max(index, 0), frameCount - 1);
}

export function SpriteRenderer({
  intent,
  frameIndex,
  atlasUrl,
  onAtlasError,
  onFrameSequenceError
}: SpriteRendererProps) {
  const model = spriteRenderModelForIntent(intent, frameIndex, atlasUrl);

  if (model.sourceKind === "png-sequence") {
    return (
      <div
        className={model.className}
        data-animation={model.animation}
        data-loop={model.loop ? "true" : "false"}
        data-frame-source="png-sequence"
        data-frame-index={model.frameIndex}
        data-frame-count={model.frameCount}
        data-frame-fps={model.fps}
        style={model.style}
      >
        <img
          className="sprite-sequence-frame"
          src={model.frameUrl}
          onError={() => onFrameSequenceError?.(model.animation)}
          alt=""
          draggable={false}
        />
      </div>
    );
  }

  if (model.sourceKind === "missing") {
    return (
      <div
        className={`${model.className} is-missing-source`}
        data-animation={model.animation}
        data-loop={model.loop ? "true" : "false"}
        data-frame-source="missing"
        style={model.style}
      />
    );
  }

  return (
    <div
      className={model.className}
      data-animation={model.animation}
      data-loop={model.loop ? "true" : "false"}
      data-frame-source="petdex-row"
      data-sprite-scale-x={SPRITE_RENDER_SCALE_X}
      data-sprite-scale-y={SPRITE_RENDER_SCALE_Y}
      data-sprite-column={model.frame.columnIndex}
      data-sprite-row={model.row}
      data-atlas-kind={model.atlasKind}
      style={model.style}
    >
      <img
        className="sprite-atlas"
        src={model.atlasUrl}
        style={model.atlasStyle}
        onError={onAtlasError}
        alt=""
        draggable={false}
      />
    </div>
  );
}

export function PartnerRenderer({
  intent,
  frameIndex,
  atlasUrl,
  onAtlasError,
  onFrameSequenceError,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture
}: PartnerRendererProps) {
  return (
    <>
      {intent.bubble ? (
        <div
          className={`bubble priority-${intent.bubble.priority}`}
          data-workflow-state={intent.bubble.state}
        >
          <span>{intent.bubble.state}</span>
          <strong>{intent.bubble.text}</strong>
        </div>
      ) : null}

      <div
        className={`partner ${dragging ? "is-dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
      >
        <SpriteRenderer
          intent={intent}
          frameIndex={frameIndex}
          atlasUrl={atlasUrl}
          onAtlasError={onAtlasError}
          onFrameSequenceError={onFrameSequenceError}
        />
      </div>
    </>
  );
}
