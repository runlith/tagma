import { parseTextPatch, type PatchHunk } from '@runlith/utils/patch';

const ASK_CEILING = 10_000;
const LINE_CEILING = 100_000;
const CHARACTER_CEILING = 8_000_000;

export type DiffState =
  | { readonly kind: 'binary' }
  | { readonly kind: 'unmeasured' }
  | { readonly kind: 'oversized'; readonly atLeast: number }
  | { readonly kind: 'deferred'; readonly lines: number }
  | { readonly kind: 'identical' }
  | { readonly kind: 'partial'; readonly hunks: readonly PatchHunk[] }
  | { readonly kind: 'rows'; readonly hunks: readonly PatchHunk[] };

export type DiffStateInput = {
  readonly patch: string | readonly PatchHunk[];
  readonly binary: boolean;
  readonly timedOut: boolean;
  readonly asked: boolean;
};

export function patchIdentity(patch: string | readonly PatchHunk[], path: string | null): string {
  const size = typeof patch === 'string' ? patch.length : patch.reduce((lines, hunk) => lines + hunk.lines.length, 0);
  return `${path ?? ''}:${size}`;
}

export function diffState(input: DiffStateInput): DiffState {
  if (input.binary) return { kind: 'binary' };
  if (!input.asked && typeof input.patch === 'string' && input.patch.length > CHARACTER_CEILING) {
    return { kind: 'unmeasured' };
  }
  const counted = countLines(input.patch, LINE_CEILING);
  if (counted.exceeded) return { kind: 'oversized', atLeast: counted.count };
  if (!input.asked && counted.count > ASK_CEILING) return { kind: 'deferred', lines: counted.count };
  const hunks = typeof input.patch === 'string' ? parseTextPatch(input.patch) : input.patch;
  if (hunks.length === 0) return { kind: 'identical' };
  return input.timedOut ? { kind: 'partial', hunks } : { kind: 'rows', hunks };
}

function countLines(patch: string | readonly PatchHunk[], ceiling: number): { count: number; exceeded: boolean } {
  if (typeof patch !== 'string') {
    let count = 0;
    for (const hunk of patch) {
      count += hunk.lines.length;
      if (count > ceiling) return { count, exceeded: true };
    }
    return { count, exceeded: false };
  }
  if (patch.length === 0) return { count: 0, exceeded: false };
  let count = 1;
  for (let index = 0; index < patch.length; index += 1) {
    if (patch.charCodeAt(index) !== 10) continue;
    count += 1;
    if (count > ceiling) return { count, exceeded: true };
  }
  return { count, exceeded: false };
}
