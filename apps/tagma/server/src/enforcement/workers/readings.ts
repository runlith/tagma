import type { Assembled } from '@tagma/inspection/builtins';
import type { InspectionMemo } from '@tagma/inspection/node/memo';
import type { Reading } from '@tagma/inspection/node/reading';
import { carriesOf } from '@tagma/inspection/node/slices';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { blobTree, type ParseMemo } from '@runlith/code-facts/blobs';
import { installedStamp } from '@runlith/code-facts/js/config';
import type { Git } from '@runlith/git/Git';
import { pointedTreeAt, type TreeDifference } from '@runlith/git/trees';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import type { Compared, Installs } from './asks.js';
import { GrowingPaths, type Side, texts } from './sides.js';
import { gitUnread, unreadFrom } from './unread.js';

const keyOf = (inspection: Assembled, places: readonly string[], compared: Compared, tree: string): string =>
  `readings/${createHash('sha256')
    .update(JSON.stringify([inspection, places, compared]))
    .digest('hex')}/${tree}`;

type Known = {
  readonly reading: Reading;
  readonly headroom: number;
  readonly installed: readonly (readonly [string, string | null])[];
};

export const knownReading = (
  memo: InspectionMemo | undefined,
  inspection: Assembled,
  places: readonly string[],
  compared: Compared,
  tree: string,
): Known | undefined => {
  const held = memo?.get(keyOf(inspection, places, compared, tree));
  return held === undefined
    ? undefined
    : { reading: { violations: held.violations, unjudged: [] }, headroom: held.headroom ?? 0, installed: held.installed ?? [] };
};

export const keepReading = (
  memo: InspectionMemo | undefined,
  inspection: Assembled,
  places: readonly string[],
  compared: Compared,
  tree: string,
  reading: Reading,
  headroom: number,
  installed: Installs,
): void => {
  if (reading.unjudged.length > 0) return;
  memo?.set(keyOf(inspection, places, compared, tree), {
    dependencies: [],
    installed: installed.map(([path, file]) => [path, installedStamp(file ?? undefined)]),
    listings: [],
    violations: reading.violations,
    headroom,
    read: [],
  });
};

export const carried = Effect.fn('inspecting.carried')(function* (
  git: Git['Service'],
  root: string,
  inspection: Assembled,
  ends: { readonly from: string; readonly to: string },
  changes: readonly TreeDifference[],
  imports: ParseMemo,
) {
  const sideOf = (commit: string, objectOf: (change: TreeDifference) => string | null): Side => {
    const objects = new Map<string, string>();
    for (const change of changes) {
      const object = objectOf(change);
      if (object !== null) objects.set(change.path, object);
    }
    return { commit, tree: '', slot: root, listed: { objects, sizes: new Map(), ordered: new GrowingPaths() }, parts: [''], paths: [] };
  };
  const base = sideOf(ends.from, (change) => change.before);
  const built = sideOf(ends.to, (change) => change.after);
  const held = new Map<string, string>();
  for (;;) {
    const missing = { base: new Set<string>(), built: new Set<string>() };
    const before = blobTree(base.listed.objects, held, imports, ADAPTERS, missing.base);
    const after = blobTree(built.listed.objects, held, imports, ADAPTERS, missing.built);
    const same = yield* Effect.try({ try: () => carriesOf(inspection, before, after, changes), catch: unreadFrom });
    if (missing.base.size === 0 && missing.built.size === 0) return same;
    const fetched = yield* texts(git, root, [
      { ...base, paths: [...missing.base] },
      { ...built, paths: [...missing.built] },
    ]);
    if (fetched.unread.size > 0) return false;
    for (const [object, text] of fetched.held) held.set(object, text);
  }
});

export const growth = Effect.fn('inspecting.growth')(function* (
  git: Git['Service'],
  root: string,
  trees: { readonly from: string; readonly to: string },
  paths: readonly string[],
) {
  const [before, after] = yield* Effect.all([pointedTreeAt(git, root, trees.from, paths), pointedTreeAt(git, root, trees.to, paths)], {
    concurrency: 2,
  }).pipe(Effect.mapError(gitUnread));
  return paths.reduce((sum, path) => sum + Math.max(0, (after.sizes.get(path) ?? 0) - (before.sizes.get(path) ?? 0)), 0);
});
