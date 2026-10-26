import type { SettingEntry } from '@tagma/server/settings/contract/wire/catalog';
import { scaleOf } from '@tagma/server/settings/contract/wire/units';

export function percentOf(share: number): number {
  return Math.round(share * 100);
}

export function shareOf(percent: number): number {
  return percent / 100;
}

export function settingText(entry: SettingEntry, value: unknown): string {
  if (value === undefined || value === null) return 'nothing';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) return value.length === 1 ? '1 entry' : `${value.length} entries`;
  if (typeof value === 'number') return numberText(entry, value);
  if (typeof value === 'string') return labelOf(entry, value);
  return JSON.stringify(value);
}

function labelOf(entry: SettingEntry, value: string): string {
  if (entry.control?.kind !== 'choice') return value;
  return entry.control.choices.find((choice) => choice.value === value)?.label ?? value;
}

function numberText(entry: SettingEntry, value: number): string {
  const control = entry.control;
  if (control?.kind === 'share') return `${percentOf(value)}%`;
  if (control?.kind !== 'number') return String(value);
  const scaled = scaleOf(control.unit, value);
  return `${scaled.shown} ${scaled.unit}`;
}
