import { Effect } from 'effect';
import { contentDigest } from '@runlith/files/content';
import type { Git } from '@runlith/git/Git';
import { stagedEntriesAt, treeEntriesAt, type TreeEntries, type TreeEntry } from '@runlith/git/entries';
import type { PreparedEntries, PreparedHashes } from '../../change-record/contract/service/prepared.js';
import { actingGit, runGit } from '../../platform/git/ownGit.js';
import { indexWrites } from '../../platform/git/index.js';
import { nul, stagedTexts } from '../../change-record/prepared/tree.js';

const SYNC_TRIES = 8;

const sameEntry = (one: TreeEntry | undefined, other: TreeEntry | undefined): boolean =>
  one?.mode === other?.mode && one?.object === other?.object;

const entryKey = (entry: TreeEntry): string => `${entry.mode}\0${entry.object}`;

type Due = { readonly due: readonly string[]; readonly unread: readonly string[] };

export type KnownEntries = ReadonlyMap<string, ReadonlyMap<string, TreeEntry | null>>;

export const knownEntries = ({ base, tree, before, after }: PreparedEntries, built: string, commit: string): KnownEntries =>
  new Map([...(base === null ? [] : [[base, before] as const]), ...(tree === built ? [[commit, after] as const] : [])]);

const dueOf = Effect.fn('submitWork.indexDue')(function* (
  git: Git['Service'],
  root: string,
  bases: readonly (string | null)[],
  commit: string,
  changed: readonly string[],
  hashes: ReadonlyMap<string, PreparedHashes>,
  index: string,
  known: KnownEntries,
): Effect.fn.Return<Due> {
  const reader = actingGit(git, 'submit-index');
  const entriesAt = (revision: string): Effect.Effect<TreeEntries> => {
    const sides = known.get(revision);
    if (sides === undefined || !changed.every((path) => sides.has(path))) return treeEntriesAt(reader, root, revision, changed);
    const entries = new Map<string, TreeEntry>();
    for (const path of changed) {
      const entry = sides.get(path);
      if (entry !== undefined && entry !== null) entries.set(path, entry);
    }
    return Effect.succeed({ entries, unread: new Map<string, string>() });
  };
  const [staged, published] = yield* Effect.all([stagedEntriesAt(reader, root, changed), entriesAt(commit)], {
    concurrency: 2,
  });
  const unread = new Set([...staged.unread.keys(), ...published.unread.keys()]);
  const settled = new Set(changed.filter((path) => !unread.has(path) && sameEntry(staged.entries.get(path), published.entries.get(path))));
  const untouched = new Set<string>();
  const level = new Set<string>();
  let previous: ReadonlyMap<string, TreeEntry> = new Map();
  const history = yield* Effect.forEach(
    [...new Set(bases)],
    (base) =>
      Effect.map(
        base === null ? Effect.succeed({ entries: new Map<string, TreeEntry>(), unread: new Map<string, string>() }) : entriesAt(base),
        (before) => ({ base, before }),
      ),
    { concurrency: 3 },
  );
  for (const { base, before } of history) {
    const last = base === bases.at(-1);
    for (const path of before.unread.keys()) if (!settled.has(path)) unread.add(path);
    for (const path of changed) {
      if (!before.unread.has(path) && sameEntry(staged.entries.get(path), before.entries.get(path))) (last ? level : untouched).add(path);
    }
    if (last) previous = before.entries;
  }
  for (const path of level) untouched.add(path);
  const sources = new Set(
    changed.flatMap((path) => {
      const entry = previous.get(path);
      return entry !== undefined && !published.entries.has(path) && !unread.has(path) ? [entryKey(entry)] : [];
    }),
  );
  const pending = changed.filter((path) => !settled.has(path) && !unread.has(path));
  for (const path of pending) {
    const entry = staged.entries.get(path);
    if (entry !== undefined && sources.has(entryKey(entry))) untouched.add(path);
  }
  const protectedPaths = new Set<string>();
  const textsOf = pending.filter((path) => {
    const known = hashes.get(path);
    const entry = staged.entries.get(path);
    const reference = published.entries.get(path) ?? previous.get(path);
    return (
      entry !== undefined &&
      !level.has(path) &&
      ((known?.peers.size ?? 0) > 0 || (!untouched.has(path) && entry.mode === reference?.mode && (known?.carried.size ?? 0) > 0))
    );
  });
  if (textsOf.length > 0) {
    const texts = yield* stagedTexts(git, root, textsOf, index);
    for (const [at, path] of textsOf.entries()) {
      const text = texts[at];
      const known = hashes.get(path);
      if (text?._tag !== 'Success' || text.success === null) {
        if ((known?.peers.size ?? 0) > 0) protectedPaths.add(path);
        continue;
      }
      const digest = contentDigest(text.success);
      if (known?.peers.has(digest) === true) protectedPaths.add(path);
      else if (known?.carried.has(digest) === true) {
        const reference = published.entries.get(path) ?? previous.get(path);
        if (staged.entries.get(path)?.mode === reference?.mode) untouched.add(path);
      }
    }
  }
  return { due: pending.filter((path) => untouched.has(path) && !protectedPaths.has(path)), unread: [...unread] };
});

export const syncHeldIndex = Effect.fn('submitWork.syncIndex')(function* (
  git: Git['Service'],
  root: string,
  bases: readonly (string | null)[],
  commit: string,
  changed: readonly string[],
  hashes: ReadonlyMap<string, PreparedHashes>,
  index: string,
  known: KnownEntries = new Map(),
): Effect.fn.Return<readonly string[]> {
  for (let tried = 1; ; tried += 1) {
    const { due, unread } = yield* dueOf(git, root, bases, commit, changed, hashes, index, known);
    if (due.length === 0) return unread;
    const reset = yield* Effect.result(
      runGit(git, 'submit-sync', ['-C', root, 'reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul', commit], {
        stdin: nul(due),
        env: { GIT_LITERAL_PATHSPECS: '1' },
      }),
    );
    if (reset._tag === 'Success') return unread;
    if (tried >= SYNC_TRIES || reset.failure.reason !== 'locked') return [...due, ...unread];
    yield* Effect.sleep(100 * tried);
  }
});

export const syncIndex = Effect.fn('submitWork.index')(function* (
  git: Git['Service'],
  root: string,
  index: string,
  bases: readonly (string | null)[],
  commit: string,
  changed: readonly string[],
  hashes: ReadonlyMap<string, PreparedHashes>,
  prepared: string,
  known: KnownEntries,
): Effect.fn.Return<readonly string[]> {
  if (changed.length === 0) return [];
  return yield* indexWrites.hold(index, syncHeldIndex(git, root, bases, commit, changed, hashes, prepared, known)).pipe(
    Effect.catchTags({
      HoldStalled: () => Effect.succeed(changed),
      HoldCut: () => Effect.succeed(changed),
    }),
  );
});
