import { Deferred, Effect, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { searchContent, type ContentEvent, type Match, type SearchFailure, type SearchLapsed } from '@runlith/ripgrep/run';
import { versionContentLimit } from '@runlith/files/content';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import { RipgrepBinary } from '../../platform/contract/service/ripgrep.js';
import { Searches, type SearchAsk, type SearchRefusal } from '../contract/service/searches.js';
import { SEARCH_MATCHES, type SearchFrame } from '../contract/wire/search.js';

const PREVIEW_COLUMNS = 500;

const CEILING_MS = 120_000;

type Folding = { pending: Match[]; files: number; matches: number; readonly startedAt: number };

const fileFrame = (path: string, matches: readonly Match[]): SearchFrame => ({
  kind: 'file',
  file: path,
  matches: matches.map((match) => ({ line: match.line, preview: match.text, ranges: match.ranges })),
});

const doneFrame = (folding: Folding, truncated: boolean): SearchFrame => ({
  kind: 'done',
  files: folding.files,
  matches: folding.matches,
  truncated,
  elapsed: Math.max(0, Date.now() - folding.startedAt),
});

const fold = (folding: Folding, event: ContentEvent): readonly SearchFrame[] => {
  if (event._tag === 'Match') {
    const room = SEARCH_MATCHES - folding.matches;
    const kept = event.ranges.length > room ? { ...event, ranges: event.ranges.slice(0, Math.max(1, room)) } : event;
    folding.pending.push(kept);
    folding.matches += Math.max(1, kept.ranges.length);
    if (folding.matches < SEARCH_MATCHES) return [];
    const held = folding.pending;
    folding.pending = [];
    folding.files += 1;
    return [fileFrame(event.path, held), doneFrame(folding, true)];
  }
  if (event._tag === 'Summary') return [doneFrame(folding, event.partial)];
  if (event._tag === 'Context') return [];
  const held = folding.pending;
  folding.pending = [];
  if (held.length === 0) return [];
  folding.files += 1;
  return [fileFrame(event.path, held)];
};

const refusalOf = (failure: Exclude<SearchFailure, SearchLapsed>): GateRefusal<SearchRefusal> =>
  failure._tag === 'SearchFailed'
    ? new GateRefusal('search-failed', failure.message, ['correct the pattern or the globs and search again'])
    : new GateRefusal('search-unavailable', failure.message, ['search again once ripgrep can run']);

export const makeContentSearches = Effect.fnUntraced(function* (input: { readonly graphDirectory: string }) {
  const binary = yield* RipgrepBinary;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { graphDirectory } = input;
  const current = new Map<string, () => void>();

  const superseding = (root: string, events: Stream.Stream<SearchFrame, GateRefusal<SearchRefusal>>) =>
    Stream.suspend(() => {
      current.get(root)?.();
      const replaced = Deferred.makeUnsafe<void>();
      const mine = (): void => void Deferred.doneUnsafe(replaced, Effect.void);
      current.set(root, mine);
      return events.pipe(
        Stream.interruptWhen(
          Effect.andThen(
            Deferred.await(replaced),
            Effect.fail(
              new GateRefusal('search-superseded', 'a newer search of this checkout replaced this one', ['use the newer search']),
            ),
          ),
        ),
        Stream.ensuring(Effect.sync(() => void (current.get(root) === mine && current.delete(root)))),
      );
    });

  const events = (path: string, cwd: string, ask: SearchAsk): Stream.Stream<SearchFrame, GateRefusal<SearchRefusal>> => {
    const globs = [...ask.include, ...ask.exclude.map((glob) => `!${glob}`), '!.git', `!${graphDirectory}`];
    return Stream.suspend(() => {
      const folding: Folding = { pending: [], files: 0, matches: 0, startedAt: Date.now() };
      return searchContent(
        { binary: path, cwd, platform: process.platform, ceilingMs: CEILING_MS },
        {
          pattern: ask.pattern,
          globs,
          fixed: !ask.regex,
          ignoreCase: !ask.caseSensitive,
          word: ask.wholeWord,
          hidden: true,
          maxFilesize: versionContentLimit,
          maxColumns: PREVIEW_COLUMNS,
        },
      ).pipe(
        Stream.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Stream.flatMap((event) => Stream.fromIterable(fold(folding, event))),
        Stream.takeUntil((frame) => frame.kind === 'done'),
        Stream.catchTag('SearchLapsed', () => Stream.make(doneFrame(folding, true))),
        Stream.mapError(refusalOf),
      );
    });
  };

  return Searches.of({
    run: (place, ask) => Stream.unwrap(Effect.map(binary.path(), (path) => superseding(place.rootId, events(path, place.path, ask)))),
  });
});
