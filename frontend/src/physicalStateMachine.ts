import { type PhysicalState } from "@ai-partner/resolver";

export interface PhysicalMachineState {
  state: PhysicalState;
}

export type PhysicalMachineEvent =
  | { type: "drag_start" }
  | { type: "struggle" }
  | { type: "drag_end" }
  | { type: "land" }
  | { type: "recover" }
  | { type: "reset"; reason: "pointer_cancel" | "lost_capture" | "abnormal" };

export const initialPhysicalMachineState: PhysicalMachineState = {
  state: "normal"
};

export function physicalStateMachine(
  current: PhysicalMachineState,
  event: PhysicalMachineEvent
): PhysicalMachineState {
  switch (event.type) {
    case "drag_start":
      return transition(current, "carried");
    case "struggle":
      return current.state === "carried" ? transition(current, "struggling") : current;
    case "drag_end":
      return current.state === "carried" || current.state === "struggling"
        ? transition(current, "falling")
        : current;
    case "land":
      return current.state === "falling" ? transition(current, "recovering") : current;
    case "recover":
      return current.state === "recovering" ? transition(current, "normal") : current;
    case "reset":
      return current.state === "normal" ? current : transition(current, "normal");
    default:
      return current;
  }
}

function transition(
  current: PhysicalMachineState,
  state: PhysicalState
): PhysicalMachineState {
  return current.state === state ? current : { state };
}
