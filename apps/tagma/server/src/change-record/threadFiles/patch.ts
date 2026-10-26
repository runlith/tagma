import { contentDigest, looksBinaryText } from '@runlith/files/content';
import { textChanges, type PatchHunk, type PatchLine, type PatchSpan } from '@runlith/utils/patch';
import type { AuthorshipOpen } from '../contract/wire/operations.js';
import type { CheckoutLines } from '../../workspace/contract/wire/checkout.js';

export const NUL = String.fromCharCode(0);

const UNCHANGED: readonly PatchSpan[] = [];

const leftOf = (until: number): number => Math.max(0, until - Date.now());

export const weighed = (base: string | null, bytes: string | null, until: number): CheckoutLines => {
  if (binary(base) || binary(bytes)) return 'binary';
  const patch = textChanges(base ?? '', bytes ?? '', { deadlineMs: leftOf(until) });
  return patch.timedOut ? 'unweighed' : { added: patch.added, removed: patch.removed };
};

export const binary = (text: string | null): boolean => text !== null && looksBinaryText(text);

export const PAST_BINARY = { past: 'binary' } as const;

export type End = string | null | typeof PAST_BINARY;

export const pastBinary = (end: End): end is typeof PAST_BINARY => end === PAST_BINARY;

export const sameText = (one: End, two: End): boolean => !pastBinary(one) && !pastBinary(two) && one === two;

export const digestOf = (end: End): string => (end === null ? '' : pastBinary(end) ? PAST_BINARY.past : contentDigest(end));

type Hidden = { readonly from: number; readonly to: number; readonly offset: number; readonly hunk: number };

function hiddenRuns(hunks: readonly PatchHunk[]): readonly Hidden[] {
  const runs: Hidden[] = [];
  for (const [at, hunk] of hunks.entries()) {
    if (hunk.hiddenBefore <= 0) continue;
    runs.push({
      from: hunk.beforeStart - hunk.hiddenBefore,
      to: hunk.beforeStart - 1,
      offset: hunk.afterStart - hunk.beforeStart,
      hunk: at,
    });
  }
  return runs;
}

export function openedHunks(
  hunks: readonly PatchHunk[],
  base: readonly string[],
  opens: readonly AuthorshipOpen[],
): { readonly hunks: readonly PatchHunk[] } | { readonly gone: AuthorshipOpen } {
  const runs = hiddenRuns(hunks);
  const slices = new Map<number, { from: number; to: number; offset: number }[]>();
  for (const open of opens) {
    const wanted = { from: open.at, to: open.at + open.lines - 1 };
    const run = runs.find((held) => wanted.from >= held.from && wanted.from <= held.to);
    if (run === undefined) return { gone: open };
    const held = slices.get(run.hunk) ?? [];
    held.push({ from: wanted.from, to: Math.min(wanted.to, run.to), offset: run.offset });
    slices.set(run.hunk, held);
  }
  const opened: PatchHunk[] = [];
  for (const [at, hunk] of hunks.entries()) {
    const held = (slices.get(at) ?? []).sort((one, two) => one.from - two.from);
    let standing = hunk;
    for (const slice of merged(held)) {
      const lines = context(base, slice.from, slice.to, slice.offset);
      if (slice.to === standing.beforeStart - 1) {
        standing = {
          beforeStart: slice.from,
          afterStart: slice.from + slice.offset,
          hiddenBefore: 0,
          hiddenAt: 0,
          lines: [...lines, ...standing.lines],
        };
        continue;
      }
      opened.push({
        beforeStart: slice.from,
        afterStart: slice.from + slice.offset,
        hiddenBefore: 0,
        hiddenAt: 0,
        lines,
      });
    }
    opened.push(standing);
  }
  return { hunks: counted(opened) };
}

function merged(slices: readonly { from: number; to: number; offset: number }[]): readonly { from: number; to: number; offset: number }[] {
  const held: { from: number; to: number; offset: number }[] = [];
  for (const slice of slices) {
    const last = held[held.length - 1];
    if (last !== undefined && slice.from <= last.to + 1) {
      held[held.length - 1] = { from: last.from, to: Math.max(last.to, slice.to), offset: last.offset };
      continue;
    }
    held.push({ ...slice });
  }
  return held;
}

function context(base: readonly string[], from: number, to: number, offset: number): readonly PatchLine[] {
  const lines: PatchLine[] = [];
  for (let at = from; at <= to; at += 1) {
    lines.push({
      kind: 'context',
      text: base[at - 1] ?? '',
      before: at,
      after: at + offset,
      spans: UNCHANGED,
    });
  }
  return lines;
}

function counted(hunks: readonly PatchHunk[]): readonly PatchHunk[] {
  let past = 1;
  return hunks.map((hunk) => {
    const hidden = hunk.beforeStart - past;
    const from = past;
    past = hunk.beforeStart + hunk.lines.filter((line) => line.kind !== 'added').length;
    return hidden === hunk.hiddenBefore ? hunk : { ...hunk, hiddenBefore: hidden, hiddenAt: hidden === 0 ? 0 : from };
  });
}
