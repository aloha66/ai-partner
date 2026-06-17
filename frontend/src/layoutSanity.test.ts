import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SPRITE_RENDER_HEIGHT,
  SPRITE_RENDER_WIDTH
} from "./spriteRenderer";

const stylesPath = fileURLToPath(new URL("./styles.css", import.meta.url));
const tauriConfigPath = fileURLToPath(new URL("../../src-tauri/tauri.conf.json", import.meta.url));
const styles = readFileSync(stylesPath, "utf8");
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8")) as {
  app: { windows: Array<{ width: number; height: number; minWidth: number; minHeight: number }> };
};

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
  statusPillWidth: cssPxVar("t8-status-pill-width"),
  interactionCardWidth: cssPxVar("t8-interaction-card-width"),
  interactionCardMaxHeight: cssPxVar("t8-interaction-card-max-height"),
  interactionCardPadding: cssPxVar("t8-interaction-card-padding"),
  interactionCardBorder: cssPxVar("t8-interaction-card-border"),
  interactionCardGap: cssPxVar("t8-interaction-card-gap"),
  interactionZoneGap: cssPxVar("t8-interaction-zone-gap"),
  interactionZoneBottomPadding: cssPxVar("t8-interaction-zone-bottom-padding"),
  interactionCompanionScale: Number(
    styles.match(/--t8-interaction-companion-scale:\s*([0-9.]+);/)?.[1] ?? Number.NaN
  ),
  interactionCompanionVisibleHeight: cssPxVar("t8-interaction-companion-visible-height"),
  interactionTitleLineHeight: cssPxVar("t8-interaction-title-line-height"),
  interactionTitleLines: Number(
    styles.match(/--t8-interaction-title-lines:\s*([0-9.]+);/)?.[1] ?? Number.NaN
  ),
  interactionStatusMarginTop: cssPxVar("t8-interaction-status-margin-top"),
  interactionStatusLineHeight: cssPxVar("t8-interaction-status-line-height"),
  interactionMetaPaddingY: cssPxVar("t8-interaction-meta-padding-y"),
  interactionMetaBorder: cssPxVar("t8-interaction-meta-border"),
  interactionMetaRowGap: cssPxVar("t8-interaction-meta-row-gap"),
  interactionMetaLabelLineHeight: cssPxVar("t8-interaction-meta-label-line-height"),
  interactionMetaValueLineHeight: cssPxVar("t8-interaction-meta-value-line-height"),
  interactionButtonHeight: cssPxVar("t8-interaction-button-height")
};

const tauriWindow = tauriConfig.app.windows[0];

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

  it("keeps the interaction card anchored as an overlay inside the default window", () => {
    const visibleSpriteHeight = layout.interactionCompanionVisibleHeight;

    expect(layout.interactionCardWidth).toBeLessThan(layout.windowWidth);
    expect(visibleSpriteHeight).toBeGreaterThanOrEqual(layout.spriteHeight * layout.interactionCompanionScale);
    expect(layout.interactionCardMaxHeight + layout.interactionZoneGap + visibleSpriteHeight)
      .toBeLessThanOrEqual(layout.windowHeight);
    expect(styles).toMatch(/\.interaction-card\s*\{[^}]*position:\s*relative;/s);
    expect(styles).toMatch(/\.interaction-card\s*\{[^}]*box-shadow:\s*none;/s);
    expect(styles).toMatch(/\.interaction-card\s*\{[^}]*background:\s*var\(--color-surface-strong\);/s);
    expect(styles).toMatch(/\.interaction-card\s*\{[^}]*max-height:\s*min\(/s);
    expect(styles).toMatch(/\.interaction-card h2\s*\{[\s\S]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.interaction-card h2\s*\{[\s\S]*-webkit-line-clamp:\s*var\(--t8-interaction-title-lines\);/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*460px\)\s*\{[\s\S]*\.interaction-card\s*\{[^}]*width:\s*min\(100%,\s*calc\(100vw - 12px\)\);/s);
  });

  it("fits the interaction card and companion inside the Tauri minimum height", () => {
    const cardContentHeight =
      layout.interactionTitleLineHeight * layout.interactionTitleLines +
      layout.interactionStatusMarginTop +
      layout.interactionStatusLineHeight +
      layout.interactionCardGap +
      2 * layout.interactionMetaPaddingY +
      2 * layout.interactionMetaBorder +
      layout.interactionMetaRowGap +
      layout.interactionMetaLabelLineHeight +
      layout.interactionMetaValueLineHeight +
      layout.interactionCardGap +
      layout.interactionButtonHeight;
    const cardOuterHeight =
      cardContentHeight +
      2 * layout.interactionCardPadding +
      2 * layout.interactionCardBorder;
    const minimumHeightBudget =
      tauriWindow.minHeight -
      2 * layout.padding -
      layout.interactionZoneBottomPadding -
      layout.interactionZoneGap -
      layout.interactionCompanionVisibleHeight;

    expect(cardOuterHeight).toBeLessThanOrEqual(layout.interactionCardMaxHeight);
    expect(cardOuterHeight).toBeLessThanOrEqual(minimumHeightBudget);
  });

  it("protects the minimum 380px card layout from companion overlap", () => {
    const minimumWindowWidth = 380;
    const mobileCardWidth = minimumWindowWidth - 12;
    const scaledSpriteWidth = layout.spriteWidth * layout.interactionCompanionScale;

    expect(mobileCardWidth).toBeLessThanOrEqual(minimumWindowWidth);
    expect(scaledSpriteWidth).toBeLessThan(mobileCardWidth);
    expect(styles).toMatch(/\.companion-zone\.has-interaction-card \.bubble,[\s\S]*\.companion-zone\.has-interaction-card \.status-pill\s*\{[\s\S]*display:\s*none;/s);
    expect(styles).toMatch(/\.companion-zone\.has-interaction-card \.partner\s*\{[\s\S]*width:\s*var\(--t8-sprite-width\);/s);
    expect(styles).toMatch(/\.companion-zone\.has-interaction-card \.partner\s*\{[\s\S]*margin-bottom:\s*var\(--t8-interaction-companion-overlap\);/s);
    expect(styles).toMatch(/\.companion-zone\.has-interaction-card \.partner\s*\{[\s\S]*transform:\s*scale\(var\(--t8-interaction-companion-scale\)\);/s);
    expect(styles).toMatch(/\.decision-button\s*\{[\s\S]*min-height:\s*var\(--t8-interaction-button-height\);/s);
    expect(styles).toMatch(/\.decision-button\.allow\s*\{[\s\S]*background:\s*#dcfce7;/s);
    expect(styles).toMatch(/\.decision-button\.deny\s*\{[\s\S]*background:\s*#fee2e2;/s);
  });

  it("declares light, dark, and system theme paths with CSS variables", () => {
    expect(styles).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    expect(styles).toMatch(/:root\[data-theme="light"\]/);
    expect(styles).toMatch(/:root\[data-theme="dark"\]/);
    expect(styles).toContain("--color-surface");
    expect(styles).toContain("--color-accent");
  });
});
