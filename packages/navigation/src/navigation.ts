import { isAbsolute, relative as nativeRelative, posix, sep } from 'node:path';
import { LANGUAGES } from '@runlith/code-facts/languages';
import { heldRows, type PageWalk, walking } from '@runlith/paging';
import { countMatches, matchingFiles, searchContent } from '@runlith/ripgrep/run';
import { Clock, Context, Data, Deferred, Duration, Effect, Schema, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { type Adapter, type Engine, EngineLost, Engines, type Resolved, type Spot, type Subject } from './adapter';
import type { Answer, EngineReport, Refusal, Row, Summary } from './answer';
import { findOwners, type Owner } from './owners';
import type { Question } from './question';
import type { Place, UnverifiedReason, Verdict } from './verdict';

export type Asking = { readonly root: string; readonly question: Question; readonly limit: number };

export type Paging = { readonly cursor: string; readonly limit: number };

export class SearchUnavailable extends Data.TaggedError('SearchUnavailable')<{ readonly detail: string }> {
  override get message(): string {
    return `ripgrep is not available here: ${this.detail}`;
  }
}

export type Setup = {
  readonly binary: Effect.Effect<string, SearchUnavailable>;
  readonly platform: string;
  readonly ceilingMs: number;
  readonly keep: Duration.Input;
  readonly held: number;
};

export class Navigation extends Context.Service<
  Navigation,
  {
    readonly ask: (asking: Asking) => Effect.Effect<Answer, Refusal>;
    readonly page: (paging: Paging) => Effect.Effect<Answer, Refusal>;
  }
>()('@runlith/navigation/Navigation') {}

type Judged = { readonly place: Place; readonly verdict: Verdict; readonly via: string | null };

type Computed = {
  readonly question: Question;
  readonly subject: Resolved | null;
  readonly rows: readonly Row[];
  readonly summary: Summary;
  readonly engine: EngineReport;
};

type Kept = { readonly computed: Computed; until: number };

type Searched = { readonly places: Place[]; readonly partial: boolean };

type Counted = { readonly files: Map<string, number>; readonly partial: boolean };

type Listed = { readonly paths: string[]; readonly partial: boolean };

type Entry = { readonly at: number; readonly row: Row };

const ALIAS_HOPS = 2;

//! A row's text is this many UTF-16 units each side of its occurrence, so one minified line weighs no more than a line of code.
const EXCERPT = 60;

const CODE = 'navigation';

const OWNER_LANES = 4;

const OWNER_SHOWN = 3;

const WALK: PageWalk<{ readonly answer: string }, readonly [number]> = {
  operation: 'navigation',
  order: 1,
  selection: Schema.Struct({ answer: Schema.String }),
  key: Schema.Tuple([Schema.Int]),
};

const walker = walking((): Refusal => ({ _tag: 'bad-cursor' }));

const lost = (error: EngineLost): Refusal => ({ _tag: 'engine-lost', detail: error.detail });

const placeKey = (place: Place): string => `${place.path}\0${place.line}\0${place.column}`;

const order = (left: Place, right: Place): number =>
  left.path !== right.path
    ? left.path < right.path
      ? -1
      : 1
    : left.line !== right.line
      ? left.line - right.line
      : left.column - right.column;

const slashed = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'));

const relative = (root: string, path: string): string =>
  isAbsolute(path) ? slashed(nativeRelative(root, path)) : posix.normalize(slashed(path));

const low = (text: string, at: number): boolean => (text.charCodeAt(at) & 0xfc00) === 0xdc00;

const excerpt = (text: string, start: number, end: number): string => {
  let from = Math.max(0, start - EXCERPT);
  let to = Math.min(text.length, end + EXCERPT);
  if (from > 0 && low(text, from)) from += 1;
  if (to < text.length && low(text, to)) to -= 1;
  return from === 0 && to === text.length ? text : text.slice(from, to);
};

const shortened = (place: Place, name: string): Place => ({
  ...place,
  text: excerpt(place.text, place.column - 1, place.column - 1 + name.length),
});

const distinct = (subjects: readonly Subject[]): readonly Subject[] => {
  const unique = new Map<string, Subject>();
  for (const subject of subjects) {
    const key = subject.declarations.map((place) => placeKey(place)).join('\n');
    if (!unique.has(key)) unique.set(key, subject);
  }
  return [...unique.values()];
};

const merged = (judged: readonly Judged[]): readonly Judged[] => {
  const unique = new Map<string, Judged>();
  for (const one of judged) {
    const held = unique.get(placeKey(one.place));
    if (held === undefined || (held.verdict._tag !== 'use' && one.verdict._tag === 'use')) unique.set(placeKey(one.place), one);
  }
  return [...unique.values()];
};

const summarize = (judged: readonly Judged[], outside: Summary['outside'], partial: boolean): Summary => {
  const others = new Set<string>();
  let otherMatches = 0;
  const texts = new Set<string>();
  let textMatches = 0;
  const boundary = new Map<UnverifiedReason, { matches: number; files: Set<string> }>();
  for (const { place, verdict } of judged) {
    if (verdict._tag === 'other') {
      otherMatches += 1;
      others.add(verdict.symbol);
    }
    if (verdict._tag === 'text') {
      textMatches += 1;
      texts.add(place.path);
    }
    if (verdict._tag === 'unverified') {
      const held = boundary.get(verdict.reason) ?? { matches: 0, files: new Set<string>() };
      held.matches += 1;
      held.files.add(place.path);
      boundary.set(verdict.reason, held);
    }
  }
  return {
    others: {
      matches: otherMatches,
      symbols: others.size,
    },
    texts: { matches: textMatches, files: texts.size },
    outside,
    boundary: [...boundary]
      .map(([reason, held]) => ({ reason, matches: held.matches, files: held.files.size }))
      .sort((left, right) => right.matches - left.matches || (left.reason < right.reason ? -1 : 1)),
    partial,
  };
};

const GROUPED: ReadonlySet<UnverifiedReason> = new Set(['no-adapter', 'no-program', 'unparsed', 'degraded']);

const rowsOf = (judged: readonly Judged[], question: Question): readonly Row[] => {
  const kinds = question.kinds === undefined ? undefined : new Set(question.kinds);
  const uses: Row[] = [];
  const unverified: Row[] = [];
  const boundary = new Map<string, Map<UnverifiedReason, number>>();
  for (const { place, verdict, via } of [...judged].sort((left, right) => order(left.place, right.place))) {
    if (verdict._tag === 'unverified') {
      if (GROUPED.has(verdict.reason)) {
        const reasons = boundary.get(place.path) ?? new Map<UnverifiedReason, number>();
        reasons.set(verdict.reason, (reasons.get(verdict.reason) ?? 0) + 1);
        boundary.set(place.path, reasons);
      } else unverified.push({ _tag: 'unverified', ...place, reason: verdict.reason });
    }
    if (verdict._tag === 'use' && (kinds === undefined || kinds.has(verdict.kind)))
      uses.push({ _tag: 'use', ...place, kind: verdict.kind, within: verdict.within, via });
  }
  return [
    ...uses,
    ...unverified,
    ...[...boundary].flatMap(([path, reasons]) =>
      [...reasons].map(([reason, matches]): Row => ({ _tag: 'boundary', path, reason, matches })),
    ),
  ];
};

const UNREAD: ReadonlySet<UnverifiedReason> = new Set(['no-adapter', 'no-program', 'changed']);

const ancestors = (paths: Iterable<string>): ReadonlySet<string> => {
  const dirs = new Set<string>();
  for (const dir of new Set([...paths].map((path) => posix.dirname(path)))) {
    for (let at = dir; !dirs.has(at); at = posix.dirname(at)) {
      dirs.add(at);
      if (at === '.') break;
    }
  }
  return dirs;
};

const reportOf = (
  engine: Engine,
  subject: Resolved | null,
  basis: ReadonlySet<string>,
  judged: readonly Judged[],
  opened: readonly string[],
): EngineReport => {
  const manifests = new Set(engine.capability.manifests);
  const declared = new Set(subject?.declarations.map((one) => one.path));
  const read = ancestors([
    ...declared,
    ...opened,
    ...basis,
    ...judged.flatMap(({ place, verdict }) => (verdict._tag === 'unverified' && UNREAD.has(verdict.reason) ? [] : [place.path])),
  ]);
  const stale = engine.snapshot.changed.filter(
    (path) => (manifests.has(posix.basename(path)) && read.has(posix.dirname(path))) || basis.has(path) || declared.has(path),
  );
  return {
    revision: engine.snapshot.revision,
    lag: engine.snapshot.changed.length,
    warming: engine.warming,
    stale,
    problems: engine.snapshot.problems,
  };
};

export const makeNavigation = Effect.fnUntraced(function* (setup: Setup) {
  const engines = yield* Engines;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const keepMs = Duration.toMillis(setup.keep);
  const answers = new Map<string, Kept>();

  const facts = LANGUAGES.flatMap((language) => language.extensions);

  const runOf = Effect.fnUntraced(function* (root: string) {
    const binary = yield* setup.binary.pipe(Effect.mapError((missing): Refusal => ({ _tag: 'search-failed', detail: missing.message })));
    return { binary, cwd: root, platform: setup.platform, ceilingMs: setup.ceilingMs };
  });

  const unread = (failure: { readonly message: string }): Refusal => ({ _tag: 'search-failed', detail: failure.message });

  const search = Effect.fn('navigation.search')(function* (root: string, name: string, code: readonly string[]) {
    const run = yield* runOf(root);
    return yield* searchContent(run, { pattern: name, fixed: true, word: true, typeAdd: code, types: [CODE] }).pipe(
      Stream.runFold(
        (): Searched => ({ places: [], partial: false }),
        (searched, event) => {
          if (event._tag === 'Summary') return { places: searched.places, partial: event.partial };
          if (event._tag === 'Match')
            for (const range of event.ranges)
              searched.places.push({
                path: slashed(event.path),
                line: event.line,
                column: range.start + 1,
                text: excerpt(event.text, range.start, range.end),
              });
          return searched;
        },
      ),
      Effect.mapError(unread),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
  });

  const listing = Effect.fn('navigation.files')(function* (root: string, name: string, code: readonly string[]) {
    const run = yield* runOf(root);
    return yield* matchingFiles(run, { pattern: name, fixed: true, word: true, typeAdd: code, types: [CODE] }).pipe(
      Stream.runFold(
        (): Listed => ({ paths: [], partial: false }),
        (listed, event) => {
          if (event._tag === 'Summary') return { paths: listed.paths, partial: event.partial };
          listed.paths.push(slashed(event.path));
          return listed;
        },
      ),
      Effect.mapError(unread),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
  });

  const firstIn = Effect.fn('navigation.first')(function* (root: string, name: string, path: string) {
    const run = yield* runOf(root);
    return yield* searchContent(run, { pattern: name, fixed: true, word: true, file: path }).pipe(
      Stream.runFold(
        () => 0,
        (line, event) => (line === 0 && event._tag === 'Match' ? event.line : line),
      ),
      Effect.map((line) => Math.max(line, 1)),
      Effect.mapError(unread),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
  });

  const count = Effect.fn('navigation.outside')(function* (root: string, name: string, code: readonly string[]) {
    const run = yield* runOf(root);
    return yield* countMatches(run, { pattern: name, fixed: true, word: true, typeAdd: code, typesNot: [CODE] }).pipe(
      Stream.runFold(
        (): Counted => ({ files: new Map(), partial: false }),
        (counted, event) => {
          if (event._tag === 'Summary') return { files: counted.files, partial: event.partial };
          counted.files.set(slashed(event.path), event.count);
          return counted;
        },
      ),
      Effect.mapError(unread),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
  });

  const once = <A>(held: Map<string, Deferred.Deferred<A, Refusal>>, name: string, work: Effect.Effect<A, Refusal>) => {
    const running = held.get(name);
    if (running !== undefined) return Deferred.await(running);
    const fresh = Deferred.makeUnsafe<A, Refusal>();
    held.set(name, fresh);
    return work.pipe(Deferred.into(fresh), Effect.andThen(Deferred.await(fresh)));
  };

  const finder = (root: string, engine: Engine) => {
    const code = [...new Set([...facts, ...engine.capability.extensions])].map((extension) => `${CODE}:*${extension}`);
    const searches = new Map<string, Deferred.Deferred<readonly Place[], Refusal>>();
    const counts = new Map<string, Deferred.Deferred<void, Refusal>>();
    const outside = new Map<string, number>();
    let partial = false;
    const mentions = (name: string): Effect.Effect<readonly Place[], Refusal> =>
      once(
        searches,
        name,
        search(root, name, code).pipe(
          Effect.map((searched) => {
            partial ||= searched.partial;
            return searched.places;
          }),
        ),
      );
    const counting = (name: string): Effect.Effect<void, Refusal> =>
      once(
        counts,
        name,
        count(root, name, code).pipe(
          Effect.map((counted) => {
            partial ||= counted.partial;
            for (const [path, matches] of counted.files) outside.set(path, (outside.get(path) ?? 0) + matches);
          }),
        ),
      );
    const find = (name: string): Effect.Effect<readonly Place[], Refusal> =>
      Effect.map(Effect.all([mentions(name), counting(name)], { concurrency: 2 }), ([places]) => places);
    const files = (name: string): Effect.Effect<readonly string[], Refusal> =>
      listing(root, name, code).pipe(
        Effect.map((listed) => {
          partial ||= listed.partial;
          return listed.paths;
        }),
      );
    return {
      find,
      files,
      partial: () => partial,
      outside: (): Summary['outside'] => ({ matches: [...outside.values()].reduce((sum, one) => sum + one, 0), files: outside.size }),
    };
  };

  const kitReason = (engine: Engine, ask: Question['ask']) => {
    const extensions = new Set(engine.capability.extensions);
    const covered = engine.capability.asks.includes(ask);
    const changed = new Set(engine.snapshot.changed);
    return (path: string): UnverifiedReason | null => {
      if (!covered || !extensions.has(posix.extname(path))) return 'no-adapter';
      return changed.has(path) ? 'changed' : null;
    };
  };

  const unverified = (place: Place, reason: UnverifiedReason, via: string | null = null): Judged => ({
    place,
    verdict: { _tag: 'unverified', reason },
    via,
  });

  const judged = Effect.fnUntraced(function* (
    find: (name: string) => Effect.Effect<readonly Place[], Refusal>,
    adapter: Adapter,
    reasonOf: (path: string) => UnverifiedReason | null,
    subject: Subject,
    places: readonly Place[],
    via: string | null,
    hops: number,
    basis: Set<string>,
  ): Effect.fn.Return<readonly Judged[], Refusal | EngineLost> {
    const held: Judged[] = [];
    const sent: Place[] = [];
    for (const place of places) {
      const reason = reasonOf(place.path);
      if (reason === null) sent.push(place);
      else held.push(unverified(place, reason, via));
    }
    const judgement = yield* adapter.judge({
      subject: subject.id,
      positions: sent.map(({ path, line, column }) => ({ path, line, column })),
    });
    if (judgement.verdicts.length !== sent.length)
      return yield* new EngineLost({ detail: `the adapter answered ${judgement.verdicts.length} verdicts for ${sent.length} positions` });
    for (const path of judgement.basis) basis.add(path);
    sent.forEach((place, at) => held.push({ place, verdict: judgement.verdicts[at] as Verdict, via }));
    const hopped = yield* Effect.forEach(
      judgement.aliases,
      (alias) =>
        hops < ALIAS_HOPS
          ? Effect.flatMap(find(alias.name), (found) => judged(find, adapter, reasonOf, alias, found, alias.name, hops + 1, basis))
          : Effect.succeed(alias.declarations.map((place) => unverified(shortened(place, alias.name), 'alias-cut', alias.name))),
      { concurrency: 2 },
    );
    return [...held, ...hopped.flat()];
  });

  const spotsOf = Effect.fnUntraced(function* (
    root: string,
    question: Question,
    files: (name: string) => Effect.Effect<readonly string[], Refusal>,
  ) {
    const target = question.target;
    if (target._tag === 'at') return [[{ ...target, path: relative(root, target.path) } satisfies Spot]];
    const read = yield* findOwners(root, target.owner, yield* files(target.owner)).pipe(Effect.mapError(unread));
    const unparsed = yield* Effect.forEach(
      read.unparsed,
      (path) => Effect.map(firstIn(root, target.owner, path), (line) => ({ name: target.owner, path, line })),
      { concurrency: 2 },
    );
    const member = (owner: Owner): Spot => ({ _tag: 'member', owner, member: target.member });
    const groups = [...read.found.map((owner) => [member(owner)]), ...read.imported.map((group) => group.map(member))];
    if (groups.length === 0 && unparsed.length === 0)
      return yield* Effect.fail<Refusal>({ _tag: 'missing', detail: `no declaration or import of ${target.owner} was found` });
    if (unparsed.length > 0)
      return yield* Effect.fail<Refusal>({
        _tag: 'ambiguous',
        candidates: [...read.found, ...read.imported.map((group) => group[0] as Owner), ...unparsed],
      });
    return groups;
  });

  const locateIn = Effect.fnUntraced(function* (
    adapter: Adapter,
    reasonOf: (path: string) => UnverifiedReason | null,
    group: readonly Spot[],
  ) {
    const tried: string[] = [];
    for (const spot of group) {
      const path = spot._tag === 'at' ? spot.path : spot.owner.path;
      if (reasonOf(path) === 'no-adapter') continue;
      tried.push(path);
      const located = yield* adapter.locate(spot);
      if (located.subjects.length > 0 || (located.resolved && reasonOf(path) === null)) return { subjects: located.subjects, tried };
    }
    return { subjects: [] as readonly Subject[], tried };
  });

  const compute = Effect.fnUntraced(function* (root: string, question: Question) {
    const engine = yield* engines.lease(root);
    const reasonOf = kitReason(engine, question.ask);
    const { find, files, partial, outside } = finder(root, engine);
    const target = question.target;
    const name = target._tag === 'at' ? target.name : target.member;
    const blind = (places: readonly Place[]): Computed => {
      const all = places.map((place) => unverified(place, reasonOf(place.path) ?? 'no-adapter'));
      return {
        question,
        subject: null,
        rows: rowsOf(all, question),
        summary: summarize(all, outside(), partial()),
        engine: reportOf(engine, null, new Set(), [], []),
      };
    };
    const opening = target._tag === 'at' ? relative(root, target.path) : null;
    if (opening !== null && reasonOf(opening) === 'no-adapter') return blind(yield* find(name));
    const [groups] = yield* Effect.all([spotsOf(root, question, files), question.ask === 'uses' ? find(name) : Effect.void], {
      concurrency: 2,
    });
    const readable = groups.filter((group) =>
      group.some((spot) => reasonOf(spot._tag === 'at' ? spot.path : spot.owner.path) !== 'no-adapter'),
    );
    if (readable.length === 0) return blind(yield* find(name));
    const [located, places] = yield* Effect.all(
      [
        Effect.forEach(readable, (group) => locateIn(engine.adapter, reasonOf, group), { concurrency: OWNER_LANES }),
        question.ask === 'uses' ? find(name) : Effect.succeed([]),
      ],
      { concurrency: 2 },
    );
    const opened = located.flatMap((one) => one.tried);
    const subjects = distinct(located.flatMap((one) => one.subjects));
    const [subject, ...more] = subjects;
    if (subject === undefined) {
      const shown =
        opened.length > OWNER_SHOWN
          ? `${opened.slice(0, OWNER_SHOWN).join(', ')} and ${opened.length - OWNER_SHOWN} more`
          : opened.join(', ');
      const first = readable[0]?.[0];
      const at = first?._tag === 'member' ? `as a member of ${first.owner.name} in ${shown}` : `in ${shown}`;
      const unseen = opened.some((file) => reasonOf(file) === 'changed')
        ? `; a file changed after snapshot ${engine.snapshot.revision}, so the engine has not seen it yet`
        : '';
      return yield* Effect.fail<Refusal>({ _tag: 'missing', detail: `no symbol ${name} stands ${at}${unseen}` });
    }
    if (more.length > 0)
      return yield* Effect.fail<Refusal>({
        _tag: 'ambiguous',
        candidates: subjects.flatMap((one) => one.declarations.map((place) => ({ name: one.name, path: place.path, line: place.line }))),
      });
    const declarations = subject.declarations.map((place) => shortened(place, subject.name));
    const resolved: Resolved = { name: subject.name, line: subject.line, declarations };
    const basis = new Set<string>();
    const all =
      question.ask === 'definition'
        ? declarations.map((place): Judged => {
            const reason = reasonOf(place.path);
            return reason === null
              ? { place, verdict: { _tag: 'use', kind: 'declaration', within: null }, via: null }
              : unverified(place, reason);
          })
        : yield* judged(find, engine.adapter, reasonOf, subject, places, null, 0, basis);
    const kept = merged(all);
    return {
      question,
      subject: resolved,
      rows: rowsOf(kept, question),
      summary: summarize(kept, outside(), partial()),
      engine: reportOf(engine, resolved, basis, kept, opened),
    };
  });

  const pageOf = Effect.fnUntraced(function* (answer: string, computed: Computed, cursor: string | undefined, limit: number) {
    const entries: readonly Entry[] = computed.rows.map((row, at) => ({ at, row }));
    const keyOf = (entry: Entry) => [entry.at] as const;
    const page = yield* walker.page({
      walk: WALK,
      selection: { answer },
      cursor,
      asked: limit,
      keyOf,
      read: heldRows(entries, keyOf, ['asc']),
    });
    return {
      question: computed.question,
      subject: computed.subject,
      rows: page.rows.map((entry) => entry.row),
      total: page.total,
      next: page.next,
      summary: computed.summary,
      engine: computed.engine,
    } satisfies Answer;
  });

  const keep = Effect.fnUntraced(function* (computed: Computed) {
    const now = yield* Clock.currentTimeMillis;
    for (const [id, kept] of answers) if (kept.until <= now) answers.delete(id);
    for (const id of answers.keys()) {
      if (answers.size < setup.held) break;
      answers.delete(id);
    }
    const id = crypto.randomUUID();
    answers.set(id, { computed, until: now + keepMs });
    return id;
  });

  return Navigation.of({
    ask: Effect.fn('Navigation.ask')(
      function* ({ root, question, limit }) {
        const computed = yield* Effect.scoped(compute(root, question));
        const id = yield* keep(computed);
        return yield* pageOf(id, computed, undefined, limit);
      },
      (effect) =>
        Effect.catchTags(effect, {
          EngineLost: (error) => Effect.fail(lost(error)),
          EngineFailed: (error) => Effect.fail<Refusal>({ _tag: 'engine-failed', detail: error.detail }),
          EngineDisabled: (error) => Effect.fail<Refusal>({ _tag: 'engine-disabled', detail: error.detail }),
        }),
    ),
    page: Effect.fn('Navigation.page')(function* ({ cursor, limit }) {
      const { answer } = yield* walker.recall(WALK, cursor);
      const now = yield* Clock.currentTimeMillis;
      const kept = answers.get(answer);
      if (kept === undefined || kept.until <= now) {
        answers.delete(answer);
        return yield* Effect.fail<Refusal>({ _tag: 'expired' });
      }
      kept.until = now + keepMs;
      return yield* pageOf(answer, kept.computed, cursor, limit);
    }),
  });
});
