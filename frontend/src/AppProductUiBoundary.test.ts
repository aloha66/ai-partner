import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSourcePath = fileURLToPath(new URL("./App.tsx", import.meta.url));
const appSource = readFileSync(appSourcePath, "utf8");
const userFacingText = [...appSource.matchAll(/>([^<{}]+)</g)]
  .map((match) => match[1])
  .join(" ");

describe("companion product UI boundary", () => {
  it("gates the debug panel behind debug mode and a menu toggle", () => {
    expect(appSource).toContain("resolveDebugMode");
    expect(appSource).toContain("const [debugPanelOpen, setDebugPanelOpen] = useState(false)");
    expect(appSource).toContain('data-debug-mode={debugMode}');
    expect(appSource).toContain('{debugPanelVisible ? (');
    expect(appSource).not.toContain('className="window-spike">');
  });

  it("uses a right-click menu for product controls", () => {
    expect(appSource).toContain("onContextMenu={openContextMenu}");
    expect(appSource).toContain("if (event.button !== 0)");
    expect(appSource).toContain("contextMenuPosition(event.clientX, event.clientY)");
    expect(appSource).toContain("if (event.target === event.currentTarget)");
    expect(appSource).toMatch(/role="menu"[\s\S]*aria-label="companion menu"/);
    expect(appSource).toContain("切换伴侣...");
    expect(appSource).toContain("点击穿透 6s");
    expect(appSource).toContain("打开本地 pets 目录");
    expect(appSource).toContain("诊断信息");
  });

  it("keeps selector scope local and avoids asset-management actions", () => {
    expect(appSource).toContain('role="dialog"');
    expect(appSource).toContain("搜索本地伴侣");
    expect(appSource).toContain("Local companions");
    expect(appSource).toContain("Scanning Petdex and Codex Desktop pets folders.");
    expect(appSource).toContain("Could not read local companion folders.");
    expect(userFacingText).not.toMatch(/marketplace|download|import|delete|edit companion/i);
  });

  it("keeps agent identity in the card header instead of the context grid", () => {
    expect(appSource).toContain("Agent stays in the header badge");
    expect(appSource).toContain('className="agent-badge"');
    expect(appSource).toContain(
      'interactionCard.meta.filter((item) => item.label !== "Agent")'
    );
    expect(appSource).toContain('aria-label="workflow context details"');
    expect(appSource).not.toContain('aria-label="workflow source details"');
  });

  it("keeps persistent workflow diagnostics out of the product surface", () => {
    expect(appSource).not.toContain('className="status-pill"');
  });
});
