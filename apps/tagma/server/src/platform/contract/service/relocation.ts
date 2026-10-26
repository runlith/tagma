import { Data, type Effect } from 'effect';
import { ContributionPoint } from './contribution.js';

export type Relocated = { readonly from: string; readonly to: string };

export type RelocationMiss = { readonly path: string; readonly detail: string };

export class RelocationFailed extends Data.TaggedError('RelocationFailed')<{ readonly detail: string }> {}

export type Relocation = {
  readonly id: string;
  readonly beside?: (data: Relocated) => readonly Relocated[];
  readonly carried?: (data: string) => readonly string[];
  readonly tables?: readonly string[];
  readonly relocate: (data: Relocated, places: readonly Relocated[]) => Effect.Effect<readonly RelocationMiss[], RelocationFailed>;
};

export const RELOCATIONS = new ContributionPoint<Relocation>('platform/relocations');

export const relocatedPath = (path: string, places: readonly Relocated[]): string | null => {
  for (const { from, to } of places) {
    if (path === from) return to;
    if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  }
  return null;
};

export const PATH_ENDINGS: readonly string[] = ['/', '"', "'", '\n', ' ', ':', ',', ')', ']'];

const ENDINGS = PATH_ENDINGS;

export const relocatedText = (text: string, places: readonly Relocated[]): string => {
  let moved = text;
  for (const { from, to } of places) {
    if (moved === from) return to;
    for (const ending of ENDINGS) moved = moved.split(`${from}${ending}`).join(`${to}${ending}`);
    if (moved.endsWith(from)) moved = `${moved.slice(0, -from.length)}${to}`;
  }
  return moved;
};
