import { type AnimationRef } from "@ai-partner/contracts";

export const ANIMATIONS_MANIFEST_SCHEMA_VERSION = "ai-partner.animations.v1" as const;

export interface PetJson {
  id: string;
  displayName?: string;
  description?: string;
  spritesheetPath: string;
}

export interface AnimationsManifest {
  schemaVersion: typeof ANIMATIONS_MANIFEST_SCHEMA_VERSION;
  baseAsset?: {
    format?: "petdex";
    spritesheetPath?: string;
    cellSize?: {
      width: number;
      height: number;
    };
  };
  animations?: Record<AnimationRef, AnimationManifestEntry>;
}

export interface AnimationManifestEntry {
  source: string;
  fps?: number;
  loop?: boolean;
  priority?: number;
  tags?: string[];
  fallbacks?: AnimationRef[];
}

export function isAnimationRef(value: string): value is AnimationRef {
  return /^(workflow|physical|legacy)\.[a-z0-9-]+$/.test(value);
}
