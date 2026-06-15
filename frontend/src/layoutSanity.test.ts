import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SPRITE_RENDER_HEIGHT,
  SPRITE_RENDER_WIDTH
} from "./spriteRenderer";

const stylesPath = fileURLToPath(new URL("./styles.css", import.meta.url));
const styles = readFileSync(stylesPath, "utf8");

function cssPxVar(name: string): number {
  const match = styles.match(new RegExp(`--${name}:\\s*([0-9.]+)px;`));
  if (!match) {
    throw new Error(`Missing CSS layout variable --${name}`);
  }
  return Number(match[1]);
}

const layout = {
  windowWidth: cssPxVar("t8-window-default-width"),
  windowHeight: cssPxVar("t8-window-default-height"),
  padding: cssPxVar("t8-window-padding"),
  gap: cssPxVar("t8-window-gap"),
  panelWidth: cssPxVar("t8-panel-width"),
  panelPadding: cssPxVar("t8-panel-padding"),
  panelBorder: cssPxVar("t8-panel-border"),
  companionMinWidth: cssPxVar("t8-companion-min-width"),
  companionGap: cssPxVar("t8-companion-gap"),
  spriteBottomSafeArea: cssPxVar("t8-sprite-bottom-safe-area"),
  bubbleMaxWidth: cssPxVar("t8-bubble-max-width"),
  bubbleMaxHeight: cssPxVar("t8-bubble-max-height"),
  bubblePaddingY: cssPxVar("t8-bubble-padding-y"),
  bubbleBorder: cssPxVar("t8-bubble-border"),
  bubbleGap: cssPxVar("t8-bubble-gap"),
  bubbleLabelLineHeight: cssPxVar("t8-bubble-label-line-height"),
  bubbleMessageLineHeight: cssPxVar("t8-bubble-message-line-height"),
  spriteWidth: cssPxVar("t8-sprite-width"),
  spriteHeight: cssPxVar("t8-sprite-height"),
  clickBannerWidth: cssPxVar("t8-click-banner-width"),
  clickBannerPadding: cssPxVar("t8-click-banner-padding"),
  clickBannerBorder: cssPxVar("t8-click-banner-border"),
  clickBannerLineHeight: cssPxVar("t8-click-banner-line-height"),
  menuWidth: cssPxVar("t8-menu-width"),
  menuMaxHeight: cssPxVar("t8-menu-max-height"),
  selectorWidth: cssPxVar("t8-selector-width"),
  selectorMaxHeight: cssPxVar("t8-selector-max-height"),
  statusPillWidth: cssPxVar("t8-status-pill-width")
};

describe("default 520x360 renderer layout sanity", () => {
  it("keeps the companion-only product surface inside the default window", () => {
    const contentWidth = layout.windowWidth - layout.padding * 2;
    const contentHeight = layout.windowHeight - layout.padding * 2;
    const companionWidth = contentWidth;
    const companionStackHeight =
      layout.bubbleMaxHeight +
      layout.companionGap +
      layout.spriteHeight +
      layout.companionGap +
      24 +
      layout.spriteBottomSafeArea;

    expect(companionWidth).toBeGreaterThanOrEqual(layout.companionMinWidth);
    expect(layout.spriteWidth).toBeLessThanOrEqual(companionWidth);
    expect(layout.bubbleMaxWidth).toBeLessThanOrEqual(companionWidth);
    expect(layout.statusPillWidth).toBeLessThanOrEqual(companionWidth);
    expect(companionStackHeight).toBeLessThanOrEqual(contentHeight);
    expect(styles).toMatch(/\.window-spike\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  });

  it("keeps the partner hitbox aligned to the renderer footprint", () => {
    expect(layout.spriteWidth).toBe(SPRITE_RENDER_WIDTH);
    expect(layout.spriteHeight).toBe(SPRITE_RENDER_HEIGHT);
  });

  it("keeps one-line bubble content inside its border-box overlay", () => {
    const bubbleContentHeight =
      layout.bubbleLabelLineHeight +
      layout.bubbleGap +
      layout.bubbleMessageLineHeight +
      2 * layout.bubblePaddingY +
      2 * layout.bubbleBorder;

    expect(bubbleContentHeight).toBeLessThanOrEqual(layout.bubbleMaxHeight);
  });

  it("keeps the click-through banner within the right panel footprint", () => {
    const bannerOuterHeight =
      layout.clickBannerLineHeight + 2 * layout.clickBannerPadding + 2 * layout.clickBannerBorder;

    expect(layout.clickBannerWidth).toBeLessThanOrEqual(layout.panelWidth);
    expect(bannerOuterHeight + layout.padding).toBeLessThan(layout.windowHeight);
    expect(styles).toMatch(/\.click-through-banner\s*\{[^}]*width:\s*100%;/s);
    expect(styles).not.toMatch(/\.click-through-banner\s*\{[^}]*position:\s*fixed;/s);
  });

  it("keeps the right-click menu and selector modal inside the default window", () => {
    const contentWidth = layout.windowWidth - 20;
    const contentHeight = layout.windowHeight - 20;

    expect(layout.menuWidth).toBeLessThanOrEqual(contentWidth);
    expect(layout.menuMaxHeight).toBeLessThanOrEqual(contentHeight);
    expect(layout.selectorWidth).toBeLessThanOrEqual(contentWidth);
    expect(layout.selectorMaxHeight).toBeLessThanOrEqual(contentHeight);
    expect(styles).toMatch(/\.selector-backdrop\s*\{[^}]*place-items:\s*end center;/s);
    expect(styles).not.toMatch(/marketplace|download|import|delete|edit companion/i);
  });

  it("keeps runtime strip labels short enough for the default right panel", () => {
    const runtimeLabels = ["drg", "r1", "fail", "auto"];
    const conservativeTextWidth = runtimeLabels.join("").length * 5;
    const iconAndGapBudget = 2 * 14 + 5 * 6;
    const panelInnerWidth = layout.panelWidth - 2 * layout.panelPadding - 2 * layout.panelBorder;

    expect(conservativeTextWidth + iconAndGapBudget).toBeLessThanOrEqual(panelInnerWidth);
  });

  it("declares light, dark, and system theme paths with CSS variables", () => {
    expect(styles).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    expect(styles).toMatch(/:root\[data-theme="light"\]/);
    expect(styles).toMatch(/:root\[data-theme="dark"\]/);
    expect(styles).toContain("--color-surface");
    expect(styles).toContain("--color-accent");
  });
});
