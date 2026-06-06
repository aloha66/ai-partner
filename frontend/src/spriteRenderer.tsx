import { type CSSProperties, type PointerEventHandler } from "react";
import {
  type AnimationIntent,
  type AnimationRef,
  type ProceduralEffect
} from "@ai-partner/contracts";
import {
  legacyAnimationByPetdexRow,
  PETDEX_COLUMNS,
  PETDEX_ATLAS_HEIGHT,
  PETDEX_ATLAS_WIDTH,
  type PetdexRow
} from "@ai-partner/assets/petdex";
import { spriteFrame, type SpriteFrame } from "./spriteProbe";

export const DEFAULT_SPRITE_SCALE = 7 / 8;

const canonicalPetdexRows = {
  "workflow.idle": "idle",
  "workflow.running": "running",
  "workflow.reading": "review",
  "workflow.editing": "running",
  "workflow.waiting": "waiting",
  "workflow.error": "failed",
  "workflow.done": "waving",
  "physical.carried": "idle",
  "physical.struggling": "running-left",
  "physical.falling": "idle",
  "physical.recovering": "idle"
} as const satisfies Partial<Record<AnimationRef, PetdexRow>>;

const petdexRowByAnimation = {
  ...Object.fromEntries(
    Object.entries(legacyAnimationByPetdexRow).map(([row, animation]) => [animation, row])
  ),
  ...canonicalPetdexRows
} as Partial<Record<AnimationRef, PetdexRow>>;

export interface SpriteRenderModel {
  animation: AnimationRef;
  row: PetdexRow;
  frame: SpriteFrame;
  className: string;
  style: CSSProperties;
  loop: boolean;
  procedural: ProceduralEffect[];
}

export interface SpriteRendererProps {
  intent: AnimationIntent;
  frameIndex: number;
  atlasUrl: string;
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
  return petdexRowByAnimation[animation] ?? "idle";
}

export function normalizeSpriteColumn(frameIndex: number): number {
  if (!Number.isFinite(frameIndex)) {
    return 0;
  }
  return ((Math.trunc(frameIndex) % PETDEX_COLUMNS) + PETDEX_COLUMNS) % PETDEX_COLUMNS;
}

function scaledSpritePixels(value: number): number {
  return value * DEFAULT_SPRITE_SCALE;
}

export function spriteRenderModelForIntent(
  intent: AnimationIntent,
  frameIndex: number,
  atlasUrl: string
): SpriteRenderModel {
  const row = petdexRowForAnimation(intent.body.animation);
  const frame = spriteFrame(row, normalizeSpriteColumn(frameIndex));
  const width = scaledSpritePixels(frame.width);
  const height = scaledSpritePixels(frame.height);
  const procedural = [...intent.body.procedural].sort();
  const className = [
    "sprite-frame",
    intent.body.loop ? "is-looping" : "is-once",
    ...procedural.map((effect) => `effect-${effect}`)
  ].join(" ");

  return {
    animation: intent.body.animation,
    row,
    frame,
    className,
    loop: intent.body.loop,
    procedural,
    style: {
      width,
      height,
      backgroundImage: `url("${atlasUrl}")`,
      backgroundSize: `${scaledSpritePixels(PETDEX_ATLAS_WIDTH)}px ${scaledSpritePixels(
        PETDEX_ATLAS_HEIGHT
      )}px`,
      backgroundPosition: `-${frame.columnIndex * width}px -${frame.rowIndex * height}px`
    }
  };
}

export function SpriteRenderer({ intent, frameIndex, atlasUrl }: SpriteRendererProps) {
  const model = spriteRenderModelForIntent(intent, frameIndex, atlasUrl);

  return (
    <div
      className={model.className}
      data-animation={model.animation}
      data-loop={model.loop ? "true" : "false"}
      data-sprite-scale={DEFAULT_SPRITE_SCALE}
      data-sprite-column={model.frame.columnIndex}
      data-sprite-row={model.row}
      style={model.style}
    />
  );
}

export function PartnerRenderer({
  intent,
  frameIndex,
  atlasUrl,
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
        <SpriteRenderer intent={intent} frameIndex={frameIndex} atlasUrl={atlasUrl} />
      </div>
    </>
  );
}
