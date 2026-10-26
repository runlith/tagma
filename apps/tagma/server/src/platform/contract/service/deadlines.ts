export const CEILINGS = {
  callWait: 60_000,
  callCap: 15 * 60_000,
  modelRequest: 30 * 60_000,
  ask: 120_000,
  writer: { firstUnitWait: 60_000, recoveryWait: 60_000, runningUnit: 60_000, runningLargeUnit: 10 * 60_000 },
} as const;

export type BuiltinCost = { readonly perFileMs: number; readonly perMibMs: number };

export type AskCeiling = { readonly ms: number; readonly tooLarge: boolean };

export const askCeiling = (cost: BuiltinCost, files: number, mib: number): AskCeiling => {
  const derived = 10_000 + cost.perFileMs * files + cost.perMibMs * mib;
  return { ms: Math.min(derived, CEILINGS.ask), tooLarge: derived > CEILINGS.ask };
};

const PROGRAM_FLOOR_MS = 60_000;
const PROGRAM_HISTORY = 20;

export const programCeiling = (recentMs: readonly number[]): number => {
  const window = recentMs.slice(-PROGRAM_HISTORY).toSorted((a, b) => a - b);
  if (window.length === 0) return CEILINGS.callCap;
  const p95 = window[Math.min(window.length - 1, Math.ceil(window.length * 0.95) - 1)]!;
  return Math.min(CEILINGS.callCap, Math.max(PROGRAM_FLOOR_MS, 10 * p95));
};

export const heldCeiling = (declared: number): number => Math.min(declared, CEILINGS.callCap);
