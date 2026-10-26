import type { SettingUnit } from '../../../platform/contract/wire/setting.js';

type Step = { readonly name: string; readonly size: number };

const LADDERS: Record<SettingUnit, readonly Step[]> = {
  bytes: [
    { name: 'GB', size: 1024 ** 3 },
    { name: 'MB', size: 1024 ** 2 },
    { name: 'KB', size: 1024 },
    { name: 'B', size: 1 },
  ],
  seconds: [
    { name: 'min', size: 60 },
    { name: 's', size: 1 },
  ],
  minutes: [
    { name: 'h', size: 60 },
    { name: 'min', size: 1 },
  ],
  milliseconds: [
    { name: 'h', size: 60 * 60 * 1000 },
    { name: 'min', size: 60 * 1000 },
    { name: 's', size: 1000 },
    { name: 'ms', size: 1 },
  ],
  microseconds: [{ name: 'µs', size: 1 }],
  characters: [{ name: 'ch', size: 1 }],
  hours: [
    { name: 'd', size: 24 },
    { name: 'h', size: 1 },
  ],
  days: [{ name: 'd', size: 1 }],
  traces: [{ name: 'traces', size: 1 }],
  pings: [{ name: 'pings', size: 1 }],
  tokens: [
    { name: 'M', size: 1_000_000 },
    { name: 'k', size: 1_000 },
    { name: 'tokens', size: 1 },
  ],
};

export function unitsOf(unit: SettingUnit): readonly string[] {
  return LADDERS[unit].map((step) => step.name);
}

export type Scaled = { readonly shown: number; readonly unit: string };

export function scaleOf(unit: SettingUnit, value: number): Scaled {
  const ladder = LADDERS[unit];
  const step = ladder.find((rung) => value >= rung.size) ?? ladder[ladder.length - 1];
  const size = step?.size ?? 1;
  return { shown: trim(value / size), unit: step?.name ?? '' };
}

export function rawOf(unit: SettingUnit, shown: number, display: string): number {
  const size = LADDERS[unit].find((step) => step.name === display)?.size ?? 1;
  return Math.round(shown * size);
}

function trim(value: number): number {
  return Math.round(value * 100) / 100;
}
