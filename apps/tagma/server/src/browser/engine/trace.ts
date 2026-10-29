import type * as Trace from '@paulirish/trace_engine';
import { eventParams, isCommandFailure, type CommandFailure } from '@runlith/cdp/session';
import { streamToFile } from '@runlith/cdp/stream';
import { Clock, Deferred, Effect, Exit, FileSystem, Option, Path, Queue, Schema, Scope, Stream } from 'effect';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import { Pages } from '../contract/service/pages.js';
import { BrowserPlace, tracesOf } from '../contract/service/place.js';
import { ThreadRuns } from '../contract/service/runs.js';
import { Traces } from '../contract/service/traces.js';
import { conditionsOf, networkOf } from '../contract/wire/emulation.js';
import type { PageId } from '../contract/wire/ids.js';
import { QUIET_MS, type TraceId, type TraceSummary } from '../contract/wire/trace.js';
import type { Analysis } from './analysis.js';
import type { Attached, Drive, Paged } from './drive.js';
import { endsWithRun } from './lifetime.js';
import { ended } from './refusal.js';
import { SetDetail, Summary } from './sidecar.js';

const CATEGORIES = [
  'blink.console',
  'blink.user_timing',
  'loading',
  'devtools.timeline',
  'disabled-by-default-devtools.target-rundown',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.v8-source-rundown-sources',
  'disabled-by-default-devtools.v8-source-rundown',
  'disabled-by-default-layout_shift.debug',
  'disabled-by-default-v8.inspector',
  'disabled-by-default-v8.cpu_profiler.hires',
  'disabled-by-default-lighthouse',
  'v8.execute',
  'v8',
  'cppgc',
  'navigation,rail',
] as const satisfies typeof Trace.Types.Events.DefaultCategories;

const SAMPLING = 'disabled-by-default-v8.cpu_profiler';
const SCREENSHOTS = 'disabled-by-default-devtools.screenshot';

const READ_BYTES = 96 * 1024;
const BUFFER_KB = 64 * 1024;
const TRACES_KEPT = 10;

const LOAD_EVENTS: ReadonlySet<string> = new Set([
  'Network.requestWillBeSent',
  'Network.loadingFinished',
  'Network.loadingFailed',
  'Page.frameNavigated',
  'Page.loadEventFired',
]);

type Running = {
  readonly id: TraceId;
  readonly page: PageId;
  readonly by: string | null;
  readonly state: Paged;
  readonly attached: Attached;
  readonly scope: Scope.Closeable;
  readonly listening: Scope.Closeable;
  readonly file: string;
  readonly summary: string;
  readonly set: string;
  readonly complete: Deferred.Deferred<{ readonly stream: string | undefined; readonly dataLoss: boolean }>;
  readonly conditions: string | null;
  readonly cpu: number;
  readonly network: ReturnType<typeof networkOf> | null;
  readonly named: string | null;
  settled: boolean | null;
  finished: Deferred.Deferred<TraceSummary, GateRefusal<'trace-failed'>> | null;
};

const PAGE_PART = /^[A-Za-z0-9-]+$/u;

const traceFailed = (id: TraceId, reason: string, kept: string | null) =>
  new GateRefusal(
    'trace-failed',
    `trace ${id} was not analyzed: ${reason}`,
    kept === null ? ['trace_page again'] : [`the recorded trace stays at ${kept}; Chrome DevTools opens it`, 'trace_page again'],
  );

const noTrace = (reason: string, unblock: Unblock) => new GateRefusal('no-trace', reason, unblock);

const whoOf = (by: string | null): string => (by === null ? 'the operator or an outside caller' : `thread ${by}`);

export const makeTraces = Effect.fnUntraced(function* (input: { readonly drive: Drive; readonly analysis: Analysis }) {
  const { drive, analysis } = input;
  const pages = yield* Pages;
  const runs = yield* ThreadRuns;
  const place = yield* BrowserPlace;
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Effect.scope;
  const running = new Map<PageId, Running>();

  const prune = Effect.fn('Traces.prune')(function* (dir: string) {
    const names = yield* files.readDirectory(dir);
    const stamps = [...new Set(names.map((name) => name.split('.')[0]!))].sort();
    const old = new Set(stamps.slice(0, Math.max(0, stamps.length - TRACES_KEPT)));
    for (const name of names) if (old.has(name.split('.')[0]!)) yield* files.remove(path.join(dir, name), { force: true });
  });

  const collect = Effect.fn('Traces.collect')(function* (held: Running) {
    const { session } = held.attached;
    const stopped = Effect.flatMap(session.ended, (end) =>
      Effect.fail(
        new GateRefusal(
          'trace-failed',
          `the browser session of page ${held.page} ended (${end}) before its trace was handed over; Chromium drops a trace with the session that recorded it`,
          ['trace_page again'],
        ),
      ),
    );
    const complete = yield* Effect.raceFirst(Effect.andThen(session.send('Tracing.end'), Deferred.await(held.complete)), stopped);
    if (complete.stream === undefined) return yield* traceFailed(held.id, 'the browser handed back no trace stream', null);
    const bytes = yield* streamToFile(session, complete.stream, held.file, READ_BYTES).pipe(
      Effect.provideService(FileSystem.FileSystem, files),
    );
    return { bytes, dataLoss: complete.dataLoss };
  });

  const finishing = Effect.fnUntraced(function* (held: Running) {
    const collected = yield* collect(held).pipe(
      Effect.catchIf(isCommandFailure, (failure: CommandFailure) =>
        Effect.fail(traceFailed(held.id, `the browser did not hand over the trace: ${failure.message}`, null)),
      ),
      Effect.catchTag('PlatformError', (failure) =>
        Effect.fail(traceFailed(held.id, `the trace file was not written: ${failure.message}`, null)),
      ),
    );
    const summary = yield* analysis
      .analyze({
        file: held.file,
        summary: held.summary,
        set: held.set,
        recorded: {
          trace: held.id,
          path: held.file,
          bytes: collected.bytes,
          conditions: held.conditions,
          dataLoss: collected.dataLoss,
          settled: held.settled,
        },
        metadata: { cpuThrottling: held.cpu, networkThrottling: held.named, network: held.network },
      })
      .pipe(Effect.catchTag('AnalysisFailed', (failure) => Effect.fail(traceFailed(held.id, failure.message, held.file))));
    yield* prune(path.dirname(held.file)).pipe(
      Effect.catchTag('PlatformError', (failure) =>
        Effect.logWarning(`browser: old traces of page ${held.page} were not pruned: ${failure.message}`),
      ),
    );
    return summary;
  });

  const finish = (held: Running): Effect.Effect<TraceSummary, GateRefusal<'trace-failed'>> =>
    Effect.suspend(() => {
      if (held.finished !== null) return Deferred.await(held.finished);
      const finished = Deferred.makeUnsafe<TraceSummary, GateRefusal<'trace-failed'>>();
      held.finished = finished;
      return Effect.andThen(
        finishing(held).pipe(
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              if (running.get(held.page) === held) {
                running.delete(held.page);
                yield* pages.mark(held.page, { trace: null });
              }
              held.state.watching -= 1;
              yield* Scope.close(held.scope, Exit.void);
              yield* Scope.close(held.listening, Exit.void);
              yield* Deferred.done(finished, exit);
            }),
          ),
          Effect.uninterruptible,
          Effect.forkIn(scope),
        ),
        Deferred.await(finished),
      );
    });

  const ending = (held: Running) =>
    finish(held).pipe(
      Effect.catchTag('GateRefusal', (refused) =>
        Effect.logInfo(`browser: trace ${held.id} ended with its run unanalyzed: ${refused.reason}`),
      ),
    );

  const begin = Effect.fn('Traces.begin')(function* (state: Paged, attached: Attached, screenshots: boolean, thread: string | null) {
    const page = state.page;
    const standing = running.get(page);
    if (standing !== undefined)
      return yield* new GateRefusal('trace-running', `page ${page} is already traced as ${standing.id}, started by ${whoOf(standing.by)}`, [
        'trace_page with action stop ends it',
      ]);
    const stamp = yield* Clock.currentTimeMillis;
    const dir = tracesOf(path, place, page);
    yield* Effect.orDie(files.makeDirectory(dir, { recursive: true }));
    const categories = [...CATEGORIES.flatMap((category) => category.split(',')), SAMPLING, ...(screenshots ? [SCREENSHOTS] : [])];
    const network = state.emulation.network;
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const listening = yield* Scope.fork(scope);
        const traceScope = yield* Scope.fork(attached.scope);
        const dropped = Effect.andThen(Scope.close(traceScope, Exit.void), Scope.close(listening, Exit.void));
        const complete = yield* Deferred.make<{ readonly stream: string | undefined; readonly dataLoss: boolean }>();
        const lost = (reason: string) =>
          Effect.andThen(
            Effect.logWarning(`browser: the end of a trace of page ${page} was unreadable: ${reason}`),
            Deferred.succeed(complete, { stream: undefined, dataLoss: true }),
          );
        const events = yield* Scope.provide(
          attached.session.events((method) => method === 'Tracing.tracingComplete'),
          listening,
        );
        yield* Stream.runForEach(events, (event) =>
          eventParams('Tracing.tracingComplete', event).pipe(
            Effect.flatMap((done) => Deferred.succeed(complete, { stream: done.stream, dataLoss: done.dataLossOccurred })),
            Effect.catchTags({
              PayloadUnreadable: (unreadable) => lost(unreadable.message),
              WorkerUnavailable: (gone) => lost(gone.message),
            }),
          ),
        ).pipe(Effect.forkIn(listening));
        yield* attached.session
          .send('Tracing.start', {
            traceConfig: { includedCategories: categories, excludedCategories: ['*'], traceBufferSizeInKb: BUFFER_KB },
            transferMode: 'ReturnAsStream',
            streamFormat: 'json',
            streamCompression: 'gzip',
          })
          .pipe(Effect.onError(() => dropped));
        const held: Running = {
          id: `${page}@${stamp}`,
          page,
          by: thread,
          state,
          attached,
          scope: traceScope,
          listening,
          file: path.join(dir, `${stamp}.json.gz`),
          summary: path.join(dir, `${stamp}.insights.json`),
          set: path.join(dir, `${stamp}.set-{n}.json`),
          complete,
          conditions: conditionsOf(state.emulation),
          cpu: state.emulation.cpu,
          network: network === null ? null : networkOf(network),
          named: typeof network === 'string' ? network : null,
          settled: null,
          finished: null,
        };
        running.set(page, held);
        state.watching += 1;
        yield* pages.mark(page, { trace: { by: thread, at: new Date(stamp).toISOString() } });
        yield* Scope.addFinalizer(
          traceScope,
          Effect.suspend(() => (held.finished === null ? Effect.asVoid(Effect.forkIn(ending(held), scope)) : Effect.void)),
        );
        if (thread !== null) yield* Scope.provide(endsWithRun(runs, thread, ending(held)), traceScope);
        return held;
      }),
    );
  });

  const settle = Effect.fn('Traces.settle')(function* (attached: Attached, cold: boolean, timeoutMs: number) {
    const changes = yield* Queue.unbounded<void>();
    const flying = new Set<string>();
    let committed = false;
    let loaded = false;
    const events = yield* attached.session.events((method) => LOAD_EVENTS.has(method));
    yield* Stream.runForEach(events, (event) =>
      Effect.gen(function* () {
        const key = (request: string) => `${event.child ?? ''}|${request}`;
        if (event.method === 'Network.requestWillBeSent')
          flying.add(key((yield* eventParams('Network.requestWillBeSent', event)).requestId));
        else if (event.method === 'Network.loadingFinished')
          flying.delete(key((yield* eventParams('Network.loadingFinished', event)).requestId));
        else if (event.method === 'Network.loadingFailed')
          flying.delete(key((yield* eventParams('Network.loadingFailed', event)).requestId));
        else if (event.child === undefined && event.method === 'Page.frameNavigated') {
          const { frame } = yield* eventParams('Page.frameNavigated', event);
          if (frame.parentId === undefined) committed = true;
        } else if (event.child === undefined && event.method === 'Page.loadEventFired' && committed) loaded = true;
        yield* Queue.offer(changes, undefined);
      }).pipe(
        Effect.catchTags({
          PayloadUnreadable: (unreadable) => Effect.logWarning(`browser: a load event was unreadable: ${unreadable.message}`),
          WorkerUnavailable: (gone) => Effect.logWarning(`browser: a load event was not read: ${gone.message}`),
        }),
      ),
    ).pipe(Effect.forkScoped);
    yield* attached.session.send('Page.reload', { ignoreCache: cold });
    const quiet = Effect.gen(function* () {
      for (;;) {
        if (!loaded || flying.size > 0) {
          yield* Queue.take(changes);
          continue;
        }
        if (Option.isNone(yield* Effect.timeoutOption(Queue.take(changes), QUIET_MS))) return true;
      }
    });
    return Option.getOrElse(yield* Effect.timeoutOption(quiet, timeoutMs), () => false);
  }, Effect.scoped);

  const decoded = <S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
    file: string,
    trace: TraceId,
    missing: GateRefusal<'no-trace'>,
  ) =>
    files.readFileString(file).pipe(
      Effect.catchTag('PlatformError', () => Effect.fail(missing)),
      Effect.flatMap((text) => Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text)),
      Effect.mapError((failure) =>
        failure instanceof GateRefusal ? failure : noTrace(`the insights of trace ${trace} are unreadable`, ['trace_page again']),
      ),
    );

  const placeOf = (trace: TraceId) => {
    const at = trace.lastIndexOf('@');
    const page = trace.slice(0, at);
    return PAGE_PART.test(page) ? { page: page as PageId, stamp: trace.slice(at + 1) } : null;
  };

  const summaryAt = Effect.fn('Traces.summaryFile')(function* (trace: TraceId) {
    const unknown = noTrace(`no trace ${trace} is kept`, ['trace_page — record one; its answer names the trace id']);
    const placed = placeOf(trace);
    if (placed === null) return yield* unknown;
    const recording = running.get(placed.page)?.id === trace;
    const missing = recording
      ? noTrace(`trace ${trace} is still recording`, ['trace_page with action stop ends it and answers its summary'])
      : unknown;
    const file = path.join(tracesOf(path, place, placed.page), `${placed.stamp}.insights.json`);
    const { version: _version, ...summary } = yield* decoded(Summary, file, trace, missing);
    return { summary, placed };
  });

  const detailAt = Effect.fn('Traces.setFile')(function* (trace: TraceId, set: string | undefined) {
    const { summary, placed } = yield* summaryAt(trace);
    const index =
      set === undefined
        ? Math.max(
            0,
            summary.sets.findIndex((held) => held.id.startsWith('NAVIGATION_')),
          )
        : summary.sets.findIndex((held) => held.id === set);
    if (summary.sets[index] === undefined)
      return yield* noTrace(`trace ${trace} has no insight set ${set ?? ''}`.trim(), [
        `name one of its sets: ${summary.sets.map((held) => held.id).join(', ') || 'it has none'}`,
      ]);
    const file = path.join(tracesOf(path, place, placed.page), `${placed.stamp}.set-${index}.json`);
    return yield* decoded(SetDetail, file, trace, noTrace(`the insights of trace ${trace} are missing`, ['trace_page again']));
  });

  const traced = (page: PageId, summary: TraceSummary) => ({ page: pages.glance(page, false), summary });

  return Traces.of({
    start: Effect.fn('Traces.start')(function* (page, screenshots, thread) {
      const held = yield* drive.drive(page, thread, (state, attached) => begin(state, attached, screenshots, thread));
      return { page: pages.glance(page, false), trace: held.id, path: held.file };
    }),
    stop: Effect.fn('Traces.stop')(function* (page, thread) {
      const held = running.get(page);
      if (held === undefined)
        return yield* noTrace(`no trace is running on page ${page}`, ['trace_page with action start or load records one']);
      yield* drive.drive(page, thread, () => Effect.void);
      return traced(page, yield* finish(held));
    }),
    load: Effect.fn('Traces.load')(function* (page, load, thread) {
      const begun: { current: Running | null } = { current: null };
      const held = yield* drive
        .drive(page, thread, (state, attached) =>
          Effect.gen(function* () {
            const started = yield* begin(state, attached, load.screenshots, thread);
            begun.current = started;
            started.settled = yield* settle(attached, load.cold, load.timeoutMs).pipe(
              Effect.catchIf(isCommandFailure, (failure) => ended(page, failure)),
            );
            return started;
          }),
        )
        .pipe(Effect.tapError(() => (begun.current === null ? Effect.void : Effect.asVoid(Effect.exit(finish(begun.current))))));
      return traced(page, yield* finish(held));
    }),
    summary: Effect.fn('Traces.summary')(function* (trace) {
      return (yield* summaryAt(trace)).summary;
    }),
    insight: Effect.fn('Traces.insight')(function* (trace, named, insight) {
      const set = yield* detailAt(trace, named);
      const detail = set.insights.find((held) => held.insight === insight);
      if (detail === undefined)
        return yield* noTrace(`insight set ${set.id} of trace ${trace} has no ${insight}`, [
          `name one of ${set.insights.map((held) => held.insight).join(', ') || 'none: the set holds no insight'}`,
        ]);
      return { set: set.id, detail };
    }),
    hot: Effect.fn('Traces.hot')(function* (trace, named, limit) {
      const set = yield* detailAt(trace, named);
      return { set: set.id, functions: set.hot.slice(0, limit), total: set.hot.length };
    }),
  });
});
