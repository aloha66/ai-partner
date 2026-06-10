import { buildProbeAtlasDataUrl } from "./spriteProbe";

export function defaultAtlasUrl(): string {
  const configuredAtlasDataUrl = import.meta.env.VITE_AI_PARTNER_DEFAULT_ATLAS_DATA_URL?.trim();
  const configuredAtlasUrl = import.meta.env.VITE_AI_PARTNER_DEFAULT_ATLAS_URL?.trim();

  if (configuredAtlasDataUrl && configuredAtlasDataUrl.length > 0) {
    return configuredAtlasDataUrl;
  }
  if (configuredAtlasUrl && configuredAtlasUrl.length > 0) {
    return configuredAtlasUrl;
  }
  return buildProbeAtlasDataUrl();
}
