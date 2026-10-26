import { textPatch, type PatchHunk } from '@runlith/utils/patch';
import type { NamedHolder } from '../../workspace/contract/wire/checkout.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { AuthoredLine, PathAuthorship } from '../contract/wire/authorship.js';
import type { AuthorshipOpen } from '../contract/wire/operations.js';
import { openedHunks } from './patch.js';

export type Placed = { readonly answer: PathAuthorship } | { readonly wouldCarry: number } | { readonly gone: AuthorshipOpen };

export type HolderLines = {
  readonly holder: NamedHolder;
  readonly added: ReadonlySet<number>;
  readonly removed: ReadonlySet<number>;
};

export type Authoring = {
  readonly rootId: RootId;
  readonly path: string;
  readonly from: string;
  readonly base: string | null;
  readonly bytes: string | null;
  readonly carries: readonly HolderLines[];
  readonly context: number;
  readonly opens: readonly AuthorshipOpen[];
  readonly limit: number;
  readonly normalized: boolean;
};

const authorOf = (patch: readonly PatchHunk[], carries: readonly HolderLines[]): readonly AuthoredLine[] => {
  const lines: AuthoredLine[] = [];
  for (const hunk of patch) {
    for (const [at, line] of hunk.lines.entries()) {
      const wrote = carries.find((carry) =>
        line.kind === 'added'
          ? line.after !== null && carry.added.has(line.after)
          : line.kind === 'removed' && line.before !== null && carry.removed.has(line.before),
      );
      lines.push({
        ...line,
        hiddenBefore: at === 0 ? hunk.hiddenBefore : 0,
        hiddenAt: at === 0 ? hunk.hiddenAt : 0,
        author: wrote?.holder ?? null,
      });
    }
  }
  return lines;
};

export function authored(asked: Authoring): Placed {
  const { rootId, path, from, base, bytes, carries, context, opens, limit } = asked;
  const sides = { before: base === null ? null : from, after: bytes === null ? null : path };
  const patch = textPatch(base ?? '', bytes ?? '', { context });
  const widened = opens.length === 0 ? { hunks: patch.hunks } : openedHunks(patch.hunks, (base ?? '').split('\n'), opens);
  if ('gone' in widened) return { gone: widened.gone };
  const stretches = widened.hunks;
  const carrying = stretches.reduce((total, hunk) => total + hunk.lines.length, 0);
  if (carrying > limit) return { wouldCarry: carrying };
  return { answer: { rootId, path, lines: authorOf(stretches, carries), binary: false, timedOut: patch.timedOut, sides } };
}
