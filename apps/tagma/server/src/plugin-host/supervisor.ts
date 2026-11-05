import { McpNotConnected, type McpResourceFailed } from '@runlith/mcp/McpFailure';
import type { McpResourceUpdated } from '@runlith/mcp/resources';
import type { McpCallOptions } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import {
  Clock,
  Context,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberMap,
  Option,
  References,
  Result,
  Scope,
  Semaphore,
  type Stream,
  Tracer,
} from 'effect';
import { FileWatcher } from '../platform/contract/service/watch.js';
import { type TreeRescan, type TreeWatch, type WatchEvent, watchAll } from '../platform/watch/tree.js';
import type { HostedPlugins } from '../plugins/contract/service/plugins.js';
import type { PluginPoints } from '../plugins/contract/service/points.js';
import type { PluginProcessRow, PluginProcessState } from '../plugins/contract/wire/rows.js';
import { HostPlace } from './contract/service/supervision.js';
import { alive, callIn, drained, environmentOf, type Generation, openGeneration, within } from './generation.js';
import { type CodeFilter, codeFilterOf, revisionOf } from './revision.js';

class ContributionsRefused extends Data.TaggedError('ContributionsRefused')<{ readonly reason: string }> {}

const TEMPORARY: ReadonlySet<string> = new Set(['PluginUnreadable', 'PluginsUnreadable']);

const SETTLE = Duration.millis(300);
const POLL = Duration.seconds(5);
const LOST: ReadonlySet<TreeRescan> = new Set(['lost', 'error', 'polling']);
const REASON_CHARACTERS = 1_000;

const clipped = (reason: string): string =>
  reason.length <= REASON_CHARACTERS ? reason : `…${reason.slice(reason.length - REASON_CHARACTERS + 1)}`;
const DRAIN = Duration.seconds(10);
const FIRST_RETRY_MS = 1_000;
const LAST_RETRY_MS = 60_000;
const STABLE_MS = 30_000;

type Slot = {
  readonly id: string;
  readonly root: string;
  readonly lock: Semaphore.Semaphore;
  live: Generation | null;
  opening: Deferred.Deferred<void> | null;
  state: PluginProcessState;
  title: string | null;
  failure: string | undefined;
  refused: string | undefined;
  restarts: number;
  failures: number;
  watch: TreeWatch | null;
  filter: CodeFilter | null;
};

export const makeSupervisor = Effect.fnUntraced(function* (input: {
  readonly points: PluginPoints['Service'];
  readonly hosted: HostedPlugins['Service'];
}) {
  const { points, hosted } = input;
  const { server } = yield* HostPlace;
  const scope = yield* Effect.scope;
  const generations = yield* Scope.fork(scope, 'parallel');
  const pending = yield* FiberMap.make<string>();
  const slots = new Map<string, Slot>();
  const context = yield* Effect.context<never>();
  const forked = Effect.runForkWith(context);
  const watcher = Context.getOption(context, FileWatcher);

  const serving = <A, E, R>(
    id: string,
    use: (generation: Generation, state: PluginProcessState) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | McpNotConnected, R> =>
    Effect.suspend(() => {
      const slot = slots.get(id);
      if (slot === undefined) return Effect.fail(new McpNotConnected({ server: id, state: 'stopped' }));
      const opening = slot.opening;
      if (opening !== null) return Deferred.await(opening).pipe(Effect.andThen(serving(id, use)));
      if (slot.live === null) return Effect.fail(new McpNotConnected({ server: id, state: slot.state }));
      return use(slot.live, slot.state);
    });

  const call: McpToolCaller['call'] = Effect.fn('PluginHost.call')((server, tool, args, options) =>
    serving(server, (generation, state) => callIn(generation, server, state, tool, args, options)),
  );

  const made = (id: string, root: string): Slot => {
    const slot: Slot = {
      id,
      root,
      lock: Semaphore.makeUnsafe(1),
      live: null,
      opening: null,
      state: 'stopped',
      title: null,
      failure: undefined,
      refused: undefined,
      restarts: 0,
      failures: 0,
      watch: null,
      filter: null,
    };
    slots.set(id, slot);
    return slot;
  };

  const schedule = Effect.fnUntraced(function* (slot: Slot, delay: Duration.Input) {
    yield* Effect.updateContext(
      Effect.forkIn(slot.lock.withPermit(FiberMap.run(pending, slot.id, Effect.sleep(delay).pipe(Effect.andThen(bring(slot))))), scope),
      (context: Context.Context<never>) => Context.omit(Tracer.ParentSpan, References.CurrentStackFrame)(context),
    );
  });

  const retry = Effect.fnUntraced(function* (slot: Slot) {
    slot.restarts += 1;
    yield* schedule(slot, Math.min(FIRST_RETRY_MS * 2 ** Math.max(slot.failures - 1, 0), LAST_RETRY_MS));
  });

  const heard = (slot: Slot, event: WatchEvent): void => {
    if ('rescan' in event) {
      void forked(schedule(slot, LOST.has(event.rescan) ? POLL : SETTLE));
      return;
    }
    const filter = slot.filter;
    if (filter !== null && !event.paths.some((path) => filter.moves(path))) return;
    void forked(schedule(slot, SETTLE));
  };

  const watched = Effect.fn('PluginHost.watched')(function* (slot: Slot) {
    if (slot.watch?.watching() === true) return;
    slot.watch?.close();
    const opening = watchAll([{ at: slot.root, recursive: true, required: true, listen: (event) => heard(slot, event) }]);
    slot.watch = yield* Option.isSome(watcher) ? Effect.provideService(opening, FileWatcher, watcher.value) : opening;
    if (!slot.watch.watching()) yield* schedule(slot, POLL);
  });

  const crashed = Effect.fn('PluginHost.crashed')(
    function* (slot: Slot, generation: Generation, reason: string) {
      if (slot.live !== generation) return;
      slot.live = null;
      generation.release();
      generation.release = () => undefined;
      slot.state = 'failed';
      slot.failure = reason;
      slot.failures = (yield* Clock.currentTimeMillis) - generation.startedAt >= STABLE_MS ? 1 : slot.failures + 1;
      yield* Scope.close(generation.scope, Exit.void);
      yield* retry(slot);
    },
    Effect.uninterruptible,
    (work, slot) => slot.lock.withPermit(work),
  );

  const retired = Effect.fnUntraced(function* (slot: Slot) {
    slot.watch?.close();
    slot.watch = null;
    const old = slot.live;
    slot.live = null;
    if (old !== null) {
      old.release();
      yield* drained(old, DRAIN);
      yield* Scope.close(old.scope, Exit.void);
    }
    if (slots.get(slot.id) === slot) slots.delete(slot.id);
    slot.state = 'stopped';
  });

  const inspected = Effect.fnUntraced(function* (slot: Slot) {
    const [plugin, filter] = yield* Effect.all([hosted.read(slot.id), codeFilterOf(slot.root)]);
    slot.filter = filter;
    const checked = points.check(slot.id, plugin.contributes);
    if (Result.isFailure(checked)) return yield* new ContributionsRefused({ reason: checked.failure });
    const environment = environmentOf(plugin.options, plugin.redact);
    return { plugin, revision: yield* revisionOf(slot.root, filter), checked: checked.success, environment };
  });

  const refresh = Effect.fn('PluginHost.refresh')(function* (slot: Slot) {
    yield* Effect.matchEffect(inspected(slot), {
      onFailure: Effect.fnUntraced(function* (failure) {
        if (failure._tag === 'PluginUnhosted') return yield* retired(slot);
        const temporary = TEMPORARY.has(failure._tag);
        const live = slot.live;
        if (live !== null && alive(live)) {
          slot.refused = failure.reason;
          if (temporary) yield* schedule(slot, POLL);
          return;
        }
        slot.state = 'failed';
        slot.failure = failure.reason;
        slot.refused = undefined;
        if (temporary) {
          slot.failures += 1;
          yield* retry(slot);
        }
      }),
      onSuccess: Effect.fnUntraced(function* ({ plugin, revision, checked, environment }) {
        const live = slot.live;
        slot.title = plugin.title;
        slot.refused = undefined;
        if (live !== null && alive(live) && live.revision === revision && live.fingerprint === environment.fingerprint) return;
        const opening = Deferred.makeUnsafe<void>();
        slot.opening = opening;
        yield* Effect.gen(function* () {
          slot.live = null;
          if (live !== null) {
            yield* drained(live, DRAIN);
            yield* Scope.close(live.scope, Exit.void);
          }
          slot.state = 'starting';
          const { data } = plugin;
          const opened = yield* Effect.result(
            openGeneration({ id: slot.id, root: slot.root, data, server, process: plugin.process, revision, environment }, generations),
          );
          live?.release();
          if (Result.isFailure(opened)) {
            slot.state = 'failed';
            slot.failure = opened.failure.reason;
            slot.failures += 1;
            return yield* retry(slot);
          }
          const generation = opened.success;
          const published = yield* Effect.result(
            points.publish({ id: slot.id, title: plugin.title, root: slot.root, data }, checked, generation.session?.descriptors ?? null, {
              call,
            }),
          );
          if (Result.isFailure(published)) {
            yield* Scope.close(generation.scope, Exit.void);
            slot.state = 'failed';
            slot.failure = published.failure.message;
            return;
          }
          generation.release = published.success;
          slot.live = generation;
          slot.state = 'running';
          slot.failure = undefined;
          const session = generation.session;
          if (session !== null) {
            yield* Effect.forkIn(
              Deferred.await(session.closed).pipe(Effect.flatMap((closed) => crashed(slot, generation, closed.message))),
              scope,
            );
          }
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              slot.opening = null;
              Deferred.doneUnsafe(opening, Effect.void);
            }),
          ),
        );
      }),
    });
  });

  const bring = Effect.fn('PluginHost.bring')(
    function* (slot: Slot): Effect.fn.Return<void> {
      if (slots.get(slot.id) !== slot) return;
      yield* watched(slot);
      yield* refresh(slot);
    },
    Effect.uninterruptible,
    (work, slot) => slot.lock.withPermit(work),
  );

  const stop = Effect.fn('PluginHost.stop')(function* (id: string) {
    const slot = slots.get(id);
    if (slot === undefined) return;
    yield* slot.lock.withPermit(Effect.uninterruptible(Effect.andThen(FiberMap.remove(pending, id), retired(slot))));
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const slot of slots.values()) {
        slot.watch?.close();
        slot.watch = null;
      }
    }),
  );

  return {
    reading: (id: string): PluginProcessRow | undefined => {
      const slot = slots.get(id);
      if (slot === undefined) return undefined;
      return {
        state: slot.state,
        tools: slot.live?.session?.descriptors.length ?? 0,
        restarts: slot.restarts,
        failure: slot.failure === undefined ? undefined : clipped(slot.failure),
        refused: slot.refused === undefined ? undefined : clipped(slot.refused),
      };
    },
    titles: (): ReadonlyMap<string, string> =>
      new Map([...slots.values()].flatMap((slot) => (slot.title === null ? [] : [[slot.id, slot.title] as const]))),
    hosting: (): readonly string[] => [...slots.keys()],
    ensure: Effect.fnUntraced(function* (id: string, root: string) {
      const standing = slots.get(id);
      if (standing !== undefined && standing.root !== root) yield* stop(id);
      yield* bring(slots.get(id) ?? made(id, root));
    }),
    changed: (id: string) => {
      const slot = slots.get(id);
      return slot === undefined ? Effect.void : bring(slot);
    },
    stop,
    call,
    callAdmitted: Effect.fn('PluginHost.callAdmitted')(
      <E>(id: string, admit: Effect.Effect<void, E>, tool: string, args: Readonly<Record<string, unknown>>, options: McpCallOptions) =>
        serving(id, (generation, state) => Effect.andThen(admit, callIn(generation, id, state, tool, args, options))),
    ),
    read: Effect.fn('PluginHost.read')((id: string, uri: string, options: McpCallOptions) =>
      serving(id, (generation, state) => within(generation, id, state, (session) => session.readResource(uri, options))),
    ),
    subscribe: Effect.fn('PluginHost.subscribe')((id: string, uri: string, options: McpCallOptions) =>
      serving(
        id,
        (generation, state): Effect.Effect<Stream.Stream<McpResourceUpdated>, McpResourceFailed | McpNotConnected, Scope.Scope> => {
          const session = generation.session;
          if (session === null || !alive(generation)) return Effect.fail(new McpNotConnected({ server: id, state }));
          return session.subscribeResource(uri, options);
        },
      ),
    ),
  };
});
