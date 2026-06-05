export const physicalStates = [
  "normal",
  "carried",
  "struggling",
  "falling",
  "recovering"
] as const;

export type PhysicalState = (typeof physicalStates)[number];
