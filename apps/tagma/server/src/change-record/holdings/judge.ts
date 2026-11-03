import { Cause, Context, Deferred, Effect, Exit, References, Result, Scope, Tracer } from 'effect';
import { chunk } from '@runlith/utils/collection';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import {
  Holding as HoldingSchema,
  type Holding,
  type HoldingsState,
  type HoldingsView,
  type UnprovenReason,
  type NobodyWhy,
} from '../contract/wire/holdings.js';
import * as Schema from 'effect/Schema';
import type { Digests, HoldingsChange } from '../contract/service/holdings.js';
import type { FoldInput } from '../lines/fold.js';
import { digestOf } from '../lines/folding.js';
import type { FoldRecall, JudgedFold } from '../lines/residence.js';
import type { FoldMemory } from '../lines/memory.js';
import type { BaseAlignment, Verdict } from '../lines/projection.js';
import { NO_WITNESSES, type Witnesses } from '../lines/evidence.js';
import type { WalkUnfinished } from '../lines/walks.js';
import type { Lane } from '../lines/lanes.js';
import {
  conversionsOf,
  headShiftAt,
  heldPathsAt,
  prepareAt,
  probeAt,
  standingOf,
  workingDigestAt,
  young,
  type Checkout,
  type InputReaders,
  type Known,
  type Prepared,
  type Probe,
  type StoredRow,
} from './inputs.js';
import { holdersOf, type Totals } from './totals.js';
import { headsRead } from './heads.js';
import { annotated, annotationsAt } from './annotation.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { holdingOf, unreadOf } from './verdicts.js';
import { witnessesAt, witnessKey } from './witnesses.js';
import type { GitMetadata } from '../record/metadata.js';
import { Descendants } from './paths.js';
import { Requests } from './requests.js';
import type { Details } from './details.js';
import { unpackVerdict } from '../lines/packed.js';

export type Folder = (
  input: FoldInput,
  cached: FoldRecall | undefined,
  alignment: BaseAlignment | undefined,
  lane: Lane,
) => Effect.Effect<JudgedFold, WalkUnfinished>;

type Ruling = { readonly holding: Holding; readonly verdict: Verdict };

export type Entry = {
  readonly holding: Holding;
  readonly probe: string;
  readonly stable: string;
  readonly prepared: string | null;
  readonly digests: Digests | null;
  readonly rows: readonly Pick<StoredRow, 'holder' | 'runId' | 'state'>[];
  readonly domain: boolean;
};

type JudgeView = Omit<HoldingsView, 'paths'> & { readonly paths: readonly Entry[] };

export type JudgeParts = {
  readonly readers: InputReaders;
  readonly folder: Folder;
  readonly memory: FoldMemory<FoldRecall>;
  readonly details: Details;
  readonly totals: Totals;
  readonly metadata: GitMetadata;
  readonly graphDirectory: string;
  readonly publish: (change: HoldingsChange) => Effect.Effect<void>;
  readonly stated: (checkout: RootId) => Effect.Effect<void>;
};

type Inputs = { readonly ready: ReadonlyMap<string, Prepared> } | { readonly cause: string };

const sameHolding = Schema.toEquivalence(HoldingSchema);

const PREPARED = 256;

const SLICE = PREPARED;

const FOLDS_AT_ONCE = 2;

const READS_AT_ONCE = 32;

export type Judge = ReturnType<typeof makeJudge>;

export const makeJudge = ({
  checkout,
  parts,
  scope,
  idle,
}: {
  readonly checkout: Checkout & { readonly rootId: RootId };
  readonly parts: JudgeParts;
  readonly scope: Scope.Closeable;
  readonly idle: () => Effect.Effect<void>;
}) => {
  const { readers, memory, totals, details } = parts;
  const entries = new Map<string, Entry>();
  const descendants = new Descendants();
  const dirty = new Set<string>();
  const now = new Set<string>();
  const later = new Set<string>();
  const requests = new Requests();
  const urgent = new Set<string>();
  const first = Deferred.makeUnsafe<void>();
  const logged = new Map<string, string>();
  const heads = headsRead();
  let quiets: Deferred.Deferred<void>[] = [];
  let views = new Set<Deferred.Deferred<JudgeView>>();
  let yielding: Deferred.Deferred<void> | null = null;
  let revision = 0;
  let head: string | null = null;
  let moves = 0;
  let announced = '';
  let row: number | null = null;
  let stale: string | null = null;
  let whole = true;
  let running = false;
  let followers = 0;
  let settled = false;

  const meta = (): Omit<HoldingsView, 'paths'> => {
    const state: HoldingsState =
      stale !== null
        ? { kind: 'stale', reason: stale }
        : !settled
          ? { kind: 'opening', paths: now.size + later.size }
          : running || whole || now.size + later.size > 0
            ? { kind: 'judging', paths: now.size + later.size }
            : { kind: 'current' };
    return { checkout: checkout.rootId, revision, head, row, state, totals: totals.checkout(checkout.rootId) };
  };

  const view = (): JudgeView => ({
    ...meta(),
    paths: [...entries.values()].filter((entry) => entry.domain),
  });

  const announce = (): Effect.Effect<void> => {
    const { state } = meta();
    const key = `${state.kind}:${state.kind === 'stale' ? state.reason : ''}:${row}:${head}`;
    if (key === announced) return Effect.void;
    announced = key;
    return parts.stated(checkout.rootId);
  };

  const failed = (side: string, cause: string): void => {
    stale = cause;
    if (logged.get(side) === cause) return;
    logged.set(side, cause);
    console.warn('[tagma] holdings could not be judged', { checkout: checkout.rootId, side, cause });
  };

  const noteUnknown = (path: string, reason: UnprovenReason): void => {
    const said = JSON.stringify(reason);
    if (logged.get(`path:${path}`) === said) return;
    logged.set(`path:${path}`, said);
    console.warn('[tagma] a held path could not be proven', { checkout: checkout.rootId, path, reason });
  };

  const unread = (probe: Probe, git: Holding['git'], reason: UnprovenReason): Ruling => {
    noteUnknown(probe.path, reason);
    const cause = reason.kind === 'unread' || reason.kind === 'worker' ? reason.cause : reason.kind;
    return {
      holding: unreadOf(probe, git, reason),
      verdict: {
        verdict: 'unknown',
        reason: 'unread',
        side: 'working',
        cause,
        writers: standingOf(probe.rows).map((one) => ({ row: one.id, holder: one.holder })),
      },
    };
  };

  const foldIn = (
    input: FoldInput,
    cached: FoldRecall | undefined,
    alignment: BaseAlignment | undefined,
    lane: Lane,
  ): Effect.Effect<JudgedFold | string> =>
    Effect.map(Effect.exit(Effect.suspend(() => parts.folder(input, cached, alignment, lane))), (exit) =>
      Exit.isSuccess(exit) ? exit.value : Cause.pretty(exit.cause),
    );

  const cachedOf = (key: string, input: FoldInput): FoldRecall | undefined => {
    const state = memory.fold(key);
    if (state === undefined) return undefined;
    const prefix =
      state.rows.length <= input.rows.length &&
      state.rows.every((one, at) => {
        const current = input.rows[at];
        return current?.id === one.id && digestOf(current.after) === one.after;
      });
    if (prefix && state.normalized === input.normalized && digestOf(state.base) === digestOf(input.base)) return state;
    memory.forget(key);
    return undefined;
  };

  const keyOf = (path: string): string => `${checkout.rootId}\0${path}`;

  const remembered = (path: string) => memory.fold(keyOf(path));

  const foldOf = Effect.fnUntraced(function* (
    path: string,
    given: Prepared,
    whole: () => Effect.Effect<Prepared | string>,
    witnesses: Witnesses,
    outside: NobodyWhy,
  ): Effect.fn.Return<{ readonly answer: JudgedFold | string; readonly used: Prepared }> {
    const key = keyOf(path);
    const folded = (input: FoldInput, cached: FoldRecall | undefined, alignment: BaseAlignment | undefined, lane: Lane) =>
      foldIn({ ...input, evidence: { outside, witnesses } }, cached, alignment, lane);
    let used = given;
    let cached = cachedOf(key, used.input);
    if (cached === undefined && given.recalled) {
      const read = yield* whole();
      if (typeof read === 'string') return { answer: read, used };
      used = read;
    }
    const lane: Lane = urgent.has(path) ? 'now' : 'later';
    let answer = yield* folded(used.input, cached, undefined, lane);
    const retried =
      cached !== undefined &&
      typeof answer !== 'string' &&
      answer.result.verdict === 'unknown' &&
      (answer.result.reason === 'alignment' || answer.result.reason === 'sequence');
    if (retried) {
      memory.forget(key);
      cached = undefined;
      if (used.recalled) {
        const read = yield* whole();
        if (typeof read === 'string') return { answer: read, used };
        used = read;
      }
      answer = yield* folded(used.input, undefined, undefined, lane);
    }
    if (
      used.input.partial === true &&
      typeof answer !== 'string' &&
      answer.result.verdict === 'unknown' &&
      answer.result.reason === 'opaque'
    ) {
      const read = yield* whole();
      if (typeof read === 'string') return { answer: read, used };
      used = read;
      answer = yield* folded(used.input, cached, undefined, lane);
    }
    if (typeof answer === 'string') {
      memory.forget(key);
      return { answer, used };
    }
    if (answer.record === null) memory.forget(key);
    else memory.keep(key, answer.record);
    return { answer, used };
  });

  const wholeOf = (probe: Probe, known: Known | undefined, lane: Lane) => (): Effect.Effect<Prepared | string> =>
    Effect.match(prepareAt(readers, checkout, [probe], lane, known), {
      onFailure: (failure) => failure.message,
      onSuccess: (read) => read.get(probe.path) ?? 'the inputs answered nothing for the path',
    });

  const verdictOf = Effect.fnUntraced(function* (
    probe: Probe,
    ready: Inputs,
    witnesses: Witnesses,
    conversions: Known | undefined,
    verdicts: Map<string, Verdict>,
  ): Effect.fn.Return<Entry> {
    const known = entries.get(probe.path);
    const git = probe.git === undefined ? (known?.holding.git ?? null) : probe.git;
    const rows = standingOf(probe.rows).map(({ holder, runId, state }) => ({ holder, runId, state }));
    const base = { probe: probe.print, stable: probe.stable, rows, domain: true, digests: null };
    const unproven = (reason: UnprovenReason): Entry => {
      details.forget(keyOf(probe.path));
      const ruling = unread(probe, git, reason);
      if (requests.owes(probe.path)) verdicts.set(probe.path, ruling.verdict);
      return { ...base, prepared: null, holding: ruling.holding };
    };
    if ('cause' in ready) return unproven({ kind: 'unread', side: 'record', cause: ready.cause });
    const one = ready.ready.get(probe.path);
    if (one === undefined) return unproven({ kind: 'worker', cause: 'the inputs answered nothing for the path' });
    const print = `${probe.print}\n${one.print}`;
    const digests = { head: digestOf(one.input.head), working: digestOf(one.input.working) };
    if (known !== undefined && known.prepared === print && known.holding.git === git) {
      if (!requests.owes(probe.path)) return { ...known, ...base, prepared: print, digests };
      const packed = details.read(keyOf(probe.path), print);
      if (packed !== undefined) {
        verdicts.set(probe.path, unpackVerdict(packed));
        return { ...known, ...base, prepared: print, digests };
      }
    }
    const { answer, used } = yield* foldOf(
      probe.path,
      one,
      wholeOf(probe, conversions, urgent.has(probe.path) ? 'now' : 'later'),
      witnesses,
      probe.unattributed === null ? { kind: 'external' } : { kind: 'unattributed', ...probe.unattributed },
    ).pipe(
      Effect.withSpan('Holdings.path', {
        attributes: {
          'holdings.rows': one.input.rows.length,
          'fold.cached': remembered(probe.path) !== undefined,
        },
      }),
    );
    if (typeof answer === 'string') return unproven({ kind: 'worker', cause: answer });
    const verdict = answer.result;
    const prepared = `${probe.print}\n${used.print}`;
    details.keep(keyOf(probe.path), prepared, answer.packed);
    if (requests.owes(probe.path)) verdicts.set(probe.path, verdict);
    const holding = holdingOf(probe, git, verdict, answer.nobody);
    if (holding.verdict.verdict === 'unknown') noteUnknown(probe.path, holding.verdict.reason);
    else logged.delete(`path:${probe.path}`);
    return {
      ...base,
      prepared,
      digests: { head: digestOf(used.input.head), working: digestOf(used.input.working) },
      holding,
    };
  });

  const store = Effect.fnUntraced(function* (results: ReadonlyMap<string, Entry>, batch: readonly string[]) {
    const holders = batch.flatMap((path) => {
      const after = results.get(path);
      return after?.domain === true ? holdersOf(after.holding) : [];
    });
    const marks = yield* annotationsAt(readers, holders);
    const changed: Holding[] = [];
    const gone: string[] = [];
    const touched = new Set<string>();
    for (const path of batch) {
      const before = entries.get(path);
      const after = results.get(path);
      const kept = after !== undefined && after.domain ? { ...after, holding: annotated(after.holding, after.rows, marks) } : undefined;
      if (kept === undefined) {
        details.forget(keyOf(path));
        if (before === undefined) continue;
        entries.delete(path);
        if (before.domain) {
          gone.push(path);
          for (const holder of totals.apply(checkout.rootId, before.holding, undefined)) touched.add(holder);
        }
        continue;
      }
      if (before?.domain === true && sameHolding(before.holding, kept.holding)) {
        entries.set(path, { ...kept, holding: before.holding });
        continue;
      }
      entries.set(path, kept);
      changed.push(kept.holding);
      const previous = before?.domain === true ? before.holding : undefined;
      for (const holder of totals.apply(checkout.rootId, previous, kept.holding)) touched.add(holder);
    }
    if (changed.length + gone.length === 0) return;
    revision += changed.length + gone.length;
    yield* parts.publish({ checkout: checkout.rootId, revision, changed, gone, holders: touched });
  });

  const answer = (
    batch: readonly string[],
    results: ReadonlyMap<string, Entry>,
    verdicts?: ReadonlyMap<string, Verdict>,
  ): Effect.Effect<void> =>
    Effect.forEach(
      batch,
      (path) =>
        Effect.gen(function* () {
          const entry = results.has(path) ? (entries.get(path) ?? results.get(path)) : undefined;
          const verdict = verdicts?.get(path);
          const judged =
            entry === undefined || verdict === undefined
              ? null
              : { holding: entry.holding, verdict, print: entry.prepared ?? entry.probe, head, digests: entry.digests };
          yield* requests.answer(path, judged);
          if (!entries.has(path) && !dirty.has(path) && !now.has(path) && !later.has(path)) descendants.remove(path);
        }),
      { discard: true },
    );

  const judge = Effect.fn('Holdings.judge')(function* (batch: readonly string[], cut: Deferred.Deferred<void> | null) {
    yield* Effect.annotateCurrentSpan({ 'holdings.paths': batch.length, 'holdings.urgent': cut === null });
    const lane: Lane = cut === null ? 'now' : 'later';
    const kept = yield* Effect.result(parts.metadata.keep(checkout.dir, batch));
    if (kept._tag === 'Failure') {
      failed('metadata', kept.failure.reason);
      return yield* answer(batch, new Map());
    }
    const paths = kept.success;
    const seen = moves;
    const { units } = readers;
    const [probed, witnessed] = yield* Effect.all(
      [
        Effect.result(
          probeAt(readers, checkout, paths, {
            scope: new Set(paths.filter((path) => requests.requires(path))),
            expected: head ?? undefined,
            heads,
          }),
        ),
        Effect.result(witnessesAt(units, readers.store, checkout.rootId, paths)),
      ],
      { concurrency: 2 },
    );
    const unreadSide = probed._tag === 'Failure' ? probed.failure : witnessed._tag === 'Failure' ? witnessed.failure : null;
    if (unreadSide !== null || probed._tag === 'Failure' || witnessed._tag === 'Failure') {
      failed('record', unreadSide?.message ?? 'the record could not be read');
      yield* answer(batch, new Map());
      return;
    }
    const witnesses = witnessed.success;
    const probes = new Map<string, Probe>();
    for (const [path, probe] of probed.success.probes) {
      const key = witnessKey(witnesses.get(path) ?? NO_WITNESSES);
      probes.set(path, key === '' ? probe : { ...probe, stable: `${probe.stable}\n${key}`, print: `${probe.print}\n${key}` });
    }
    if (moves === seen) head = probed.success.head;
    if (probed.success.status.read) {
      stale = null;
      logged.delete('status');
    } else failed('status', probed.success.status.cause);
    const asked: Probe[] = [];
    const touched: Probe[] = [];
    const results = new Map<string, Entry>();
    const verdicts = new Map<string, Verdict>();
    const recall = (probe: Probe, entry: Entry): boolean => {
      if (!requests.owes(probe.path)) return true;
      if (entry.prepared === null) return false;
      const packed = details.read(keyOf(probe.path), entry.prepared);
      if (packed === undefined) return false;
      verdicts.set(probe.path, unpackVerdict(packed));
      return true;
    };
    for (const probe of probes.values()) {
      const entry = entries.get(probe.path);
      if (entry === undefined || entry.stable !== probe.stable) asked.push(probe);
      else if (entry.probe === probe.print && !young(probe)) {
        if (!recall(probe, entry)) asked.push(probe);
      } else if (entry.digests === null) asked.push(probe);
      else touched.push(probe);
    }
    yield* Effect.forEach(
      touched,
      (probe) =>
        Effect.map(workingDigestAt(readers, checkout, probe, lane), (digest) => {
          const entry = entries.get(probe.path);
          if (Result.isFailure(digest) || entry === undefined || digest.success !== entry.digests?.working || !recall(probe, entry))
            asked.push(probe);
        }),
      { concurrency: READS_AT_ONCE, discard: true },
    );
    const known =
      asked.length === 0
        ? undefined
        : yield* conversionsOf(
            readers,
            checkout,
            asked.map((probe) => probe.path),
          );
    for (const part of chunk(asked, PREPARED)) {
      const read = yield* Effect.result(prepareAt(readers, checkout, part, lane, known, remembered, true));
      const ready: Inputs = read._tag === 'Success' ? { ready: read.success } : { cause: read.failure.message };
      const folds = Effect.forEach(
        part,
        (probe) =>
          Effect.map(
            verdictOf(probe, ready, witnesses.get(probe.path) ?? NO_WITNESSES, known, verdicts),
            (entry) => void results.set(probe.path, entry),
          ),
        {
          concurrency: FOLDS_AT_ONCE,
          discard: true,
        },
      );
      if (cut === null) yield* folds;
      else yield* Effect.raceFirst(folds, Deferred.await(cut));
    }
    const rest = new Set(asked.filter((probe) => !results.has(probe.path)).map((probe) => probe.path));
    const done = rest.size === 0 ? batch : batch.filter((path) => !rest.has(path));
    requests.defer([...rest]);
    for (const path of rest) if (!now.has(path)) later.add(path);
    for (const path of done) {
      const probe = probes.get(path);
      if (probe === undefined) continue;
      const entry = results.get(path) ?? entries.get(path);
      if (entry === undefined) continue;
      const rows = standingOf(probe.rows).map(({ holder, runId, state }) => ({ holder, runId, state }));
      results.set(path, { ...entry, probe: probe.print, stable: probe.stable, rows, domain: rows.length > 0 || dirty.has(path) });
    }
    const stored = yield* Effect.result(store(results, done));
    if (stored._tag === 'Failure') {
      failed('record', stored.failure.message);
      yield* answer(done, new Map());
      return;
    }
    yield* Effect.annotateCurrentSpan({
      'holdings.folded': asked.length - rest.size,
      'holdings.yielded': rest.size,
      'fold.cache.bytes': memory.retained + readers.walks.retained,
      'fold.cache.budget': memory.limit + readers.walks.limit,
      'verdict.cache.bytes': details.retained,
      'verdict.cache.budget': details.limit,
    });
    yield* answer(done, results, verdicts);
    if (moves !== seen && probed.success.head !== head) yield* shift(done);
    yield* announce();
  });

  const next = (): readonly string[] => {
    const batch: string[] = [];
    urgent.clear();
    for (const path of now) {
      batch.push(path);
      urgent.add(path);
    }
    if (batch.length === 0)
      for (const path of later) {
        if (batch.length >= SLICE) break;
        batch.push(path);
        if (views.size > 0) urgent.add(path);
      }
    for (const path of batch) {
      now.delete(path);
      later.delete(path);
      descendants.add(path);
    }
    requests.begin(batch);
    return batch;
  };

  const drained = Effect.fnUntraced(function* (exit: Exit.Exit<void>) {
    running = false;
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      failed('defect', Cause.pretty(exit.cause));
      yield* requests.fail();
    }
    settled = true;
    yield* Deferred.succeed(first, undefined);
    if (now.size > 0 || whole || later.size > 0) yield* kick();
    else {
      const owed = quiets;
      quiets = [];
      if (!running && !whole && now.size === 0 && later.size === 0 && views.size > 0) {
        const reading = views;
        views = new Set();
        const snapshot = view();
        for (const one of reading) yield* Deferred.succeed(one, snapshot);
      }
      for (const one of owed) yield* Deferred.succeed(one, undefined);
      yield* announce();
      yield* idle();
    }
  });

  const drain = Effect.gen(function* () {
    for (;;) {
      if (whole) {
        whole = false;
        const domain = yield* Effect.result(heldPathsAt(readers, checkout.rootId));
        if (domain._tag === 'Failure') failed('domain', domain.failure.message);
        else for (const path of [...new Set(domain.success), ...entries.keys(), ...dirty]) if (!now.has(path)) later.add(path);
      }
      const batch = next();
      if (batch.length === 0) break;
      if (urgent.size > 0) yield* judge(batch, null);
      else {
        const cut = Deferred.makeUnsafe<void>();
        yielding = cut;
        yield* judge(batch, cut).pipe(Effect.ensuring(Effect.sync(() => void (yielding = null))));
      }
    }
  }).pipe(Effect.exit, Effect.flatMap(drained));

  const kick = (): Effect.Effect<void> => {
    if (running) return Effect.void;
    running = true;
    return Effect.andThen(
      Effect.updateContext(Effect.forkIn(drain, scope), (context: Context.Context<never>) =>
        Context.omit(Tracer.ParentSpan, References.CurrentStackFrame)(context),
      ),
      announce(),
    );
  };

  const shift = (paths: readonly string[] | 'all'): Effect.Effect<void> => {
    if (paths !== 'all' && paths.length === 0) return Effect.void;
    if (paths === 'all') whole = true;
    else for (const path of paths) if (!now.has(path)) later.add(path);
    return kick();
  };

  const judged = Effect.fnUntraced(function* (paths: readonly string[], scope?: 'required') {
    const owed = requests.admit(paths, scope);
    for (const path of paths) {
      later.delete(path);
      now.add(path);
    }
    if (yielding !== null && paths.length > 0) yield* Deferred.succeed(yielding, undefined);
    yield* kick();
    return yield* requests.wait(owed).pipe(
      Effect.withSpan('Holdings.wait', {
        attributes: { 'holdings.checkout': checkout.rootId, 'holdings.paths': paths.length, 'holdings.path': paths[0] ?? '' },
      }),
    );
  });

  return {
    checkout,
    meta,
    shift,
    judged,
    quiet: Effect.suspend(() => {
      if (!running && !whole && now.size === 0 && later.size === 0) return Effect.void;
      const owed = Deferred.makeUnsafe<void>();
      quiets.push(owed);
      return Deferred.await(owed);
    }),
    settledView: Effect.suspend(() => {
      if (!running && !whole && now.size === 0 && later.size === 0) return Effect.succeed(view());
      const owed = Deferred.makeUnsafe<JudgeView>();
      views.add(owed);
      return Effect.andThen(kick(), Deferred.await(owed)).pipe(Effect.ensuring(Effect.sync(() => void views.delete(owed))));
    }),
    settledOnce: Deferred.await(first),
    close: Effect.andThen(
      Effect.sync(() => {
        for (const [path, entry] of entries) {
          details.forget(keyOf(path));
          if (entry.domain) totals.apply(checkout.rootId, entry.holding, undefined);
        }
        entries.clear();
        descendants.clear();
      }),
      Scope.close(scope, Exit.void),
    ),
    empty: (): boolean => entries.size === 0 && followers === 0 && !running && now.size === 0 && later.size === 0 && requests.empty,
    view,
    marked: (scopes: readonly string[] | undefined): Effect.Effect<void> =>
      shift(scopes === undefined ? 'all' : descendants.within(scopes)),
    headMoved: Effect.fnUntraced(function* (moved: string | null) {
      const old = head;
      if (old === moved) return;
      const unjudged = old === null && entries.size === 0 && dirty.size === 0;
      const changed = old === null || moved === null || whole ? undefined : yield* headShiftAt(readers, checkout, old, moved);
      moves += 1;
      head = moved;
      if (changed?._tag === 'Success') yield* shift(changed.success.filter((path) => entries.has(path) || dirty.has(path)));
      else if (!unjudged) yield* shift('all');
      yield* announce();
    }),
    follow: (shown: readonly string[], revisionRow: number): Effect.Effect<void> => {
      if (row === revisionRow) return Effect.void;
      const graph = parts.graphDirectory;
      const visible = shown.filter((path) => path !== graph && !path.startsWith(`${graph}/`));
      const fresh = new Set(visible);
      const gone = [...dirty].filter((path) => !fresh.has(path));
      const added = visible.filter((path) => !dirty.has(path));
      dirty.clear();
      for (const path of visible) dirty.add(path);
      row = revisionRow;
      return Effect.andThen(shift([...added, ...gone]), announce());
    },
    joined: (): void => {
      followers += 1;
    },
    left: (): Effect.Effect<void> => {
      followers -= 1;
      if (followers > 0) return Effect.void;
      const gone = [...dirty];
      dirty.clear();
      row = null;
      return shift(gone);
    },
    annotate: (holder: string): Effect.Effect<void, StoreFailure> => {
      const results = new Map<string, Entry>();
      for (const [path, entry] of entries) if (entry.domain && entry.rows.some((one) => one.holder === holder)) results.set(path, entry);
      return results.size === 0 ? Effect.void : store(results, [...results.keys()]);
    },
    entry: (path: string): Entry | undefined => {
      const entry = entries.get(path);
      return entry?.domain === true ? entry : undefined;
    },
    holds: (holder: string): boolean => {
      for (const entry of entries.values()) if (entry.rows.some((one) => one.holder === holder)) return true;
      return false;
    },
    annotations: (): ReadonlyMap<string, Entry['rows']> => new Map([...entries].map(([path, entry]) => [path, entry.rows] as const)),
  };
};
