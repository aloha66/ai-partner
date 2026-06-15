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
    expect(appSource).toContain(
      "const [dragDirection, setDragDirection] = useState<PhysicalHorizontalDirection | undefined>();"
    );
    expect(appSource).toContain("const dragRef = useRef<DragState | null>(null);");
    expect(appSource).toMatch(
      /const animationIntent = useMemo\([\s\S]*resolvePartnerIntent\(partnerState,\s*physicalState,[\s\S]*queued:\s*queuedAnimations[\s\S]*capabilities:\s*activeCompanion\.capabilities[\s\S]*physicalContext:\s*\{[\s\S]*horizontalDirection:\s*dragDirection[\s\S]*\[[\s\n]*partnerState,\s*physicalState,\s*queuedAnimations,\s*activeCompanion\.capabilities,\s*dragDirection[\s\n]*\][\s\S]*\);/
    );
  });

  it("keeps pointermove on the ref plus rAF window-move path with semantic direction only", () => {
    const updateManagedDrag = functionBody("updateManagedDrag");

    expect(updateManagedDrag).toContain("dragRef.current");
    expect(updateManagedDrag).toContain("window.requestAnimationFrame");
    expect(updateManagedDrag).toContain("currentCursorPosition");
    expect(updateManagedDrag).toContain("moveWindowTo");
    expect(updateManagedDrag).toContain("updateDragDirection(deltaX > 0 ? \"right\" : \"left\")");
    expect(updateManagedDrag).not.toMatch(/\bset(?!DragDirection\b)[A-Z]\w*\s*\(/);
    expect(updateManagedDrag).not.toContain("dispatchPhysical");
    expect(updateManagedDrag).not.toContain("resolvePartnerIntent");
    expect(updateManagedDrag).not.toContain("setQueuedAnimations");
  });

  it("clears transient animation state when switching companions or falling back", () => {
    const switchCompanion = functionBody("switchCompanion");
    const fallBackFromAtlasError = functionBody("fallBackFromAtlasError");

    expect(switchCompanion).toContain("setSelectedCompanion(companion.id)");
    expect(switchCompanion).toContain("setQueuedAnimations([])");
    expect(switchCompanion).toContain("setFrameIndex(0)");
    expect(switchCompanion).toContain("setAtlasFailed(false)");
    expect(fallBackFromAtlasError).toContain("setAtlasFailed(true)");
    expect(fallBackFromAtlasError).toContain("setQueuedAnimations([])");
    expect(fallBackFromAtlasError).toContain("setFrameIndex(0)");
  });
});
