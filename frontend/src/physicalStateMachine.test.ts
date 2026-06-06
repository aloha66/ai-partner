import { describe, expect, it } from "vitest";
import {
  initialPhysicalMachineState,
  physicalStateMachine,
  type PhysicalMachineEvent,
  type PhysicalMachineState
} from "./physicalStateMachine";

function reduce(events: PhysicalMachineEvent[]): PhysicalMachineState {
  return events.reduce(physicalStateMachine, initialPhysicalMachineState);
}

describe("physicalStateMachine", () => {
  it("moves from normal to carried when dragging starts", () => {
    expect(reduce([{ type: "drag_start" }]).state).toBe("carried");
  });

  it("moves from carried to struggling when drag continues long enough", () => {
    expect(reduce([{ type: "drag_start" }, { type: "struggle" }]).state).toBe(
      "struggling"
    );
  });

  it("moves from carried through falling and recovering back to normal", () => {
    expect(
      reduce([
        { type: "drag_start" },
        { type: "drag_end" }
      ]).state
    ).toBe("falling");
    expect(
      reduce([
        { type: "drag_start" },
        { type: "drag_end" },
        { type: "land" }
      ]).state
    ).toBe("recovering");
    expect(
      reduce([
        { type: "drag_start" },
        { type: "drag_end" },
        { type: "land" },
        { type: "recover" }
      ]).state
    ).toBe("normal");
  });

  it("moves from struggling through falling and recovering back to normal", () => {
    expect(
      reduce([
        { type: "drag_start" },
        { type: "struggle" },
        { type: "drag_end" }
      ]).state
    ).toBe("falling");
    expect(
      reduce([
        { type: "drag_start" },
        { type: "struggle" },
        { type: "drag_end" },
        { type: "land" },
        { type: "recover" }
      ]).state
    ).toBe("normal");
  });

  it("ignores out-of-order timer events", () => {
    const state = reduce([{ type: "land" }, { type: "recover" }, { type: "struggle" }]);

    expect(state.state).toBe("normal");
  });

  it.each([
    ["struggling", [{ type: "drag_start" }, { type: "struggle" }]],
    ["falling", [{ type: "drag_start" }, { type: "drag_end" }]],
    [
      "recovering",
      [{ type: "drag_start" }, { type: "drag_end" }, { type: "land" }]
    ]
  ] satisfies Array<[string, PhysicalMachineEvent[]]>)(
    "resets abnormal %s interaction state to normal",
    (_stateName, events) => {
      const state = physicalStateMachine(reduce(events), {
        type: "reset",
        reason: "abnormal"
      });

      expect(state.state).toBe("normal");
    }
  );

  it("keeps reset idempotent from normal", () => {
    const state = physicalStateMachine(initialPhysicalMachineState, {
      type: "reset",
      reason: "lost_capture"
    });

    expect(state).toBe(initialPhysicalMachineState);
  });
});
