import { readFile } from "node:fs/promises";

export interface ImageMetadata {
  width: number;
  height: number;
}

export type ImageMetadataReader = (filePath: string) => Promise<ImageMetadata>;

export async function readImageMetadata(filePath: string): Promise<ImageMetadata> {
  const bytes = await readFile(filePath);
  const png = readPngMetadata(bytes);
  if (png) {
    return png;
  }
  const webp = readWebpMetadata(bytes);
  if (webp) {
    return webp;
  }
  throw new Error(`Unsupported image format: ${filePath}`);
}

function readPngMetadata(bytes: Buffer): ImageMetadata | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function readWebpMetadata(bytes: Buffer): ImageMetadata | null {
  if (
    bytes.length < 30 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + readUInt24LE(bytes, 24),
      height: 1 + readUInt24LE(bytes, 27)
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff)
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    };
  }

  return null;
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}
