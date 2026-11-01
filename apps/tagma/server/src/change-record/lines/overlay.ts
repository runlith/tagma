import { alignWindow } from './alignment.js';
import { tokensOf } from './marks.js';
import type { SelectedSpan } from './selection.js';

export type Overlay = {
  readonly base: string;
  readonly selected: string;
  readonly staged: string;
  readonly working: string;
  readonly positions: readonly SelectedSpan[];
};

export const overlay = ({ base, selected, staged, working, positions }: Overlay): string | null => {
  if (staged === working) return staged;
  if (base === staged || selected === staged) return selected;
  if (base === selected) return staged;
  let remaining = 1 << 23;
  const budget = { expired: (amount: number) => (remaining -= amount) < 0 };
  const before = tokensOf(base);
  const own = tokensOf(selected);
  const index = tokensOf(staged);
  const chosen = alignWindow({ before, after: own, normalized: false }, budget);
  const incoming = alignWindow({ before, after: index, normalized: false }, budget);
  if ('reason' in chosen || 'reason' in incoming) return null;
  let at = 0;
  let shift = 0;
  const position = (point: number, end: boolean): number | null => {
    for (; at < incoming.changes.length; at += 1) {
      const change = incoming.changes[at]!;
      if (point < change.before.start) return point + shift;
      if (point > change.before.end) {
        shift = change.after.end - change.before.end;
        continue;
      }
      if (change.before.start === change.before.end) return end ? change.after.start : change.after.end;
      if (point === change.before.start) return change.after.start;
      if (point === change.before.end) return change.after.end;
      if (change.before.end - change.before.start === change.after.end - change.after.start)
        return change.after.start + point - change.before.start;
      return null;
    }
    return point + shift;
  };
  const output: string[] = [];
  let cursor = 0;
  let incomingAt = 0;
  let workingAt = 0;
  let workingShift = 0;
  let selectedAt = 0;
  let workingLines: readonly string[] | null = null;
  let workingChanges: typeof incoming.changes | null = null;
  for (const change of chosen.changes) {
    const start = position(change.before.start, false);
    const end = position(change.before.end, true);
    if (start === null || end === null || start < cursor || end < start) return null;
    output.push(index.slice(cursor, start).join(''));
    while (incomingAt < incoming.changes.length && incoming.changes[incomingAt]!.after.end <= start) incomingAt += 1;
    const kept: { at: number; text: string }[] = [];
    let missing = false;
    for (let next = incomingAt; next < incoming.changes.length && incoming.changes[next]!.after.start < end; next += 1) {
      const incomingChange = incoming.changes[next]!;
      const first = Math.max(start, incomingChange.after.start);
      const last = Math.min(end, incomingChange.after.end);
      if (first >= last) continue;
      if (workingChanges === null) {
        workingLines = tokensOf(working);
        const aligned = alignWindow({ before: index, after: workingLines, normalized: false }, budget);
        if ('reason' in aligned) return null;
        workingChanges = aligned.changes;
      }
      for (let line = first; line < last; line += 1) {
        while (workingAt < workingChanges.length && workingChanges[workingAt]!.before.end <= line) {
          const moved = workingChanges[workingAt++]!;
          workingShift = moved.after.end - moved.before.end;
        }
        if (workingAt < workingChanges.length && workingChanges[workingAt]!.before.start <= line) {
          missing = true;
          continue;
        }
        const at = line + workingShift;
        const text = index[line]!;
        if (workingLines![at] !== text) return null;
        kept.push({ at, text });
      }
    }
    if (missing && (kept.length > 0 || change.after.start === change.after.end)) return null;
    if (kept.length === 0) output.push(own.slice(change.after.start, change.after.end).join(''));
    else {
      let keptAt = 0;
      let previous = -1;
      for (let line = change.after.start; line < change.after.end; line += 1) {
        const selectedLine = line + 1;
        while (selectedAt < positions.length && positions[selectedAt]!.selected + positions[selectedAt]!.count <= selectedLine)
          selectedAt += 1;
        const span = positions[selectedAt];
        if (span === undefined || selectedLine < span.selected) return null;
        const at = span.working + selectedLine - span.selected - 1;
        const text = own[line]!;
        if (at <= previous || workingLines![at] !== text) return null;
        previous = at;
        while (keptAt < kept.length && kept[keptAt]!.at < at) output.push(kept[keptAt++]!.text);
        if (keptAt < kept.length && kept[keptAt]!.at === at) {
          if (kept[keptAt]!.text !== text) return null;
          keptAt += 1;
        }
        output.push(text);
      }
      while (keptAt < kept.length) output.push(kept[keptAt++]!.text);
    }
    cursor = end;
  }
  output.push(index.slice(cursor).join(''));
  return output.join('');
};
