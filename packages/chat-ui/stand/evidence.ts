import type { Recording } from './recording';

export type Drift = { frame: number; sentinel: number; row: string; pixels: number; text: string };
export type Evidence = {
  frames: number;
  missingFrames: number;
  comparisons: number;
  maxDrift: number;
  cumulativeDrift: number;
  maxBlank: number;
  boxComparisons: number;
  unknownBoxes: number;
  maxBoxError: number;
  firstBoxMismatch: { frame: number; row: string; outer: number; inner: number } | null;
  railFrames: number;
  railMismatches: number;
  unknownRail: number;
  firstDrift: Drift | null;
  firstRailMismatch: { frame: number; gold: string | null; geometry: string | null } | null;
};

export function evidence(recording: Recording): Evidence {
  const result: Evidence = {
    frames: recording.frames.length,
    missingFrames: recording.ticks === undefined ? 1 : Math.abs(recording.ticks.length - recording.frames.length),
    comparisons: 0,
    maxDrift: 0,
    cumulativeDrift: 0,
    maxBlank: 0,
    boxComparisons: 0,
    unknownBoxes: 0,
    maxBoxError: 0,
    firstBoxMismatch: null,
    railFrames: 0,
    railMismatches: 0,
    unknownRail: 0,
    firstDrift: null,
    firstRailMismatch: null,
  };
  const cumulative = new Map<number, number>();
  for (let index = 0; index < recording.frames.length; index += 1) {
    const current = recording.frames[index]!;
    result.maxBlank = Math.max(result.maxBlank, current.blank);
    for (const row of current.rows) {
      if (row.rect.bottom <= current.viewport.top || row.rect.top >= current.viewport.bottom) continue;
      if (row.content === undefined) {
        result.unknownBoxes += 1;
        continue;
      }
      result.boxComparisons += 1;
      const error = Math.abs(row.rect.height - row.content.height);
      result.maxBoxError = Math.max(result.maxBoxError, error);
      if (error > 0.5) result.firstBoxMismatch ??= { frame: index, row: row.key, outer: row.rect.height, inner: row.content.height };
    }
    if (current.rail) result.railFrames += 1;
    if (current.rail && current.geometry === null) result.unknownRail += 1;
    if (current.rail && current.gold !== current.geometry) {
      result.railMismatches += 1;
      result.firstRailMismatch ??= { frame: index, gold: current.gold, geometry: current.geometry };
    }
    const previous = recording.frames[index - 1];
    if (previous === undefined || previous.mutation !== current.mutation) continue;
    const before = new Map(previous.sentinels.map((sentinel) => [sentinel.id, sentinel]));
    for (const sentinel of current.sentinels) {
      const held = before.get(sentinel.id);
      if (held === undefined || held.text !== sentinel.text) continue;
      if (
        held.rect.bottom <= previous.viewport.top ||
        held.rect.top >= previous.viewport.bottom ||
        sentinel.rect.bottom <= current.viewport.top ||
        sentinel.rect.top >= current.viewport.bottom
      )
        continue;
      const drift = sentinel.rect.top - held.rect.top + current.scrollTop - previous.scrollTop;
      result.comparisons += 1;
      result.maxDrift = Math.max(result.maxDrift, Math.abs(drift));
      const sum = (cumulative.get(sentinel.id) ?? 0) + drift;
      cumulative.set(sentinel.id, sum);
      result.cumulativeDrift = Math.max(result.cumulativeDrift, Math.abs(sum));
      if (Math.abs(drift) > 0.5)
        result.firstDrift ??= { frame: index, sentinel: sentinel.id, row: sentinel.row, pixels: drift, text: sentinel.text };
    }
  }
  return result;
}
