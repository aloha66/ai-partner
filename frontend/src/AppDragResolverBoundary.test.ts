import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSourcePath = fileURLToPath(new URL("./App.tsx", import.meta.url));
const appSource = readFileSync(appSourcePath, "utf8");

function functionBody(name: string): string {
  const start = appSource.indexOf(`function ${name}`);
  if (start === -1) {
    throw new Error(`Missing function ${name}`);
  }
  const openBrace = appSource.indexOf("{", start);
  let depth = 0;
  for (let index = openBrace; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return appSource.slice(openBrace + 1, index);
      }
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

describe("App drag resolver boundary", () => {
  it("keeps resolver inputs semantic instead of pointer-coordinate driven", () => {
    expect(appSource).toContain(
      "const [physicalMachine, dispatchPhysical] = useReducer("
    );
    expect(appSource).toContain("const dragRef = useRef<DragState | null>(null);");
    expect(appSource).toMatch(
      /const animationIntent = useMemo\([\s\S]*resolvePartnerIntent\(partnerState,\s*physicalState,[\s\S]*queued:\s*queuedAnimations[\s\S]*\[[\s\n]*partnerState,\s*physicalState,\s*queuedAnimations[\s\n]*\][\s\S]*\);/
    );
  });

  it("keeps pointermove on the ref plus rAF window-move path", () => {
    const updateManagedDrag = functionBody("updateManagedDrag");

    expect(updateManagedDrag).toContain("dragRef.current");
    expect(updateManagedDrag).toContain("window.requestAnimationFrame");
    expect(updateManagedDrag).toContain("currentCursorPosition");
    expect(updateManagedDrag).toContain("moveWindowTo");
    expect(updateManagedDrag).not.toMatch(/\bset[A-Z]\w*\s*\(/);
    expect(updateManagedDrag).not.toContain("dispatchPhysical");
    expect(updateManagedDrag).not.toContain("resolvePartnerIntent");
    expect(updateManagedDrag).not.toContain("setQueuedAnimations");
  });
});
