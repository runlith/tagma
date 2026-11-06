import { McpConnectFailed, McpNotConnected, type McpResourceFailed } from '@runlith/mcp/McpFailure';
import type { McpResourceUpdated } from '@runlith/mcp/resources';
import type { McpCallOptions } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import { PROJECTS_META_KEY } from '@runlith/tagma/plugin/protocol';
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
import type { PluginProcess } from '../plugins/contract/service/format.js';
import type { HostedPlugins } from '../plugins/contract/service/plugins.js';
import { checkedOf, type PluginPoints, type PluginRef } from '../plugins/contract/service/points.js';
import type { PluginProcessRow, PluginProcessState } from '../plugins/contract/wire/rows.js';
import { HostPlace } from './contract/service/supervision.js';
import { TOOLS } from './contract/service/tools.js';
import type { ToolEntries } from './contract/wire/audience.js';

import {
  alive,
  callIn,
  drained,
  environmentOf,
  type Generation,
  type LaunchEnvironment,
  openGeneration,
  subscribed,
  within,
} from './generation.js';
import { listingDifference } from './listing.js';
import type { Offers } from './toolPoint.js';

class ContributionsRefused extends Data.TaggedError('ContributionsRefused')<{ readonly reason: string }> {}

const TEMPORARY: ReadonlySet<string> = new Set(['PluginUnreadable', 'PluginsUnreadable']);

const SETTLE = Duration.millis(300);
const POLL = Duration.seconds(5);
const LOST: ReadonlySet<TreeRescan> = new Set(['lost', 'error', 'polling']);
const PASSED_OVER: ReadonlySet<string> = new Set(['node_modules', '.git']);
const REASON_CHARACTERS = 1_000;

const clipped = (reason: string): string =>
  reason.length <= REASON_CHARACTERS ? reason : `…${reason.slice(reason.length - REASON_CHARACTERS + 1)}`;
const DRAIN = Duration.seconds(10);
const FIRST_RETRY_MS = 1_000;
const LAST_RETRY_MS = 60_000;
const STABLE_MS = 30_000;

type Standing = {
  readonly ref: PluginRef;
  readonly revision: string;
  readonly processRevision: string | null;
  readonly process: PluginProcess | null;
  readonly environment: LaunchEnvironment;
  readonly tools: ToolEntries;
  readonly withdraw: () => void;
};

type Slot = {
  readonly id: string;
  readonly root: string;
  readonly lock: Semaphore.Semaphore;
  projects: readonly number[];
  standing: Standing | null;
  live: Generation | null;
  moving: Deferred.Deferred<void> | null;
  state: PluginProcessState;
  title: string | null;
  failure: string | undefined;
  refused: string | undefined;
  rejected: boolean;
  restarts: number;
  failures: number;
  gate: number;
  watch: TreeWatch | null;
  outputs: ReadonlySet<string> | null;
};

const backoffOf = (failures: number): number => Math.min(FIRST_RETRY_MS * 2 ** Math.max(failures - 1, 0), LAST_RETRY_MS);

export const makeSupervisor = Effect.fnUntraced(function* (input: {
  readonly points: PluginPoints['Service'];
  readonly hosted: HostedPlugins['Service'];
  readonly offers: Offers;
}) {
  const { points, hosted, offers } = input;
  const { server, quiet } = yield* HostPlace;
  const quietMs = Duration.toMillis(Duration.fromInputUnsafe(quiet));
  const scope = yield* Effect.scope;
  const generations = yield* Scope.fork(scope, 'parallel');
  const pending = yield* FiberMap.make<string>();
  const quiets = yield* FiberMap.make<string>();
  const slots = new Map<string, Slot>();
  const context = yield* Effect.context<never>();
  const forked = Effect.runForkWith(context);
  const watcher = Context.getOption(context, FileWatcher);

  const notConnected = (slot: Slot) => new McpNotConnected({ server: slot.id, state: slot.state });

  const withProjects = (slot: Slot, options: McpCallOptions): McpCallOptions => ({
    ...options,
    meta: { ...options.meta, [PROJECTS_META_KEY]: slot.projects },
  });

  const serving = <A, E, R>(
    id: string,
    use: (generation: Generation, slot: Slot) => Effect.Effect<A, E, R>,
    woke = false,
  ): Effect.Effect<A, E | McpNotConnected | McpConnectFailed, R> =>
    Effect.suspend(() => {
      const slot = slots.get(id);
      if (slot === undefined) return Effect.fail(new McpNotConnected({ server: id, state: 'stopped' }));
      const moving = slot.moving;
      if (moving !== null) return Deferred.await(moving).pipe(Effect.andThen(serving(id, use, woke)));
      const live = slot.live;
      if (live !== null && alive(live)) return use(live, slot);
      if (slot.rejected)
        return Effect.fail(new McpConnectFailed({ server: id, transport: 'stdio', reason: slot.failure ?? 'its process was refused' }));
      if (woke || slot.standing?.process == null) return Effect.fail(notConnected(slot));
      return woken(slot).pipe(Effect.andThen(serving(id, use, true)));
    });

  const call: McpToolCaller['call'] = Effect.fn('PluginHost.call')((server, tool, args, options) =>
    serving(server, (generation, slot) => callIn(generation, server, slot.state, tool, args, withProjects(slot, options))),
  );

  const callAdmitted = Effect.fn('PluginHost.callAdmitted')(
    <E>(id: string, admit: Effect.Effect<void, E>, tool: string, args: Readonly<Record<string, unknown>>, options: McpCallOptions) =>
      serving(id, (generation, slot) => Effect.andThen(admit, callIn(generation, id, slot.state, tool, args, withProjects(slot, options)))),
  );

  const made = (id: string, root: string, projects: readonly number[]): Slot => {
    const slot: Slot = {
      id,
      root,
      lock: Semaphore.makeUnsafe(1),
      projects,
      standing: null,
      live: null,
      moving: null,
      state: 'stopped',
      title: null,
      failure: undefined,
      refused: undefined,
      rejected: false,
      restarts: 0,
      failures: 0,
      gate: 0,
      watch: null,
      outputs: null,
    };
    slots.set(id, slot);
    return slot;
  };

  const detached = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.updateContext(effect, (context: Context.Context<never>) =>
      Context.omit(Tracer.ParentSpan, References.CurrentStackFrame)(context),
    );

  const schedule = Effect.fnUntraced(function* (slot: Slot, delay: Duration.Input) {
    yield* detached(
      Effect.forkIn(slot.lock.withPermit(FiberMap.run(pending, slot.id, Effect.sleep(delay).pipe(Effect.andThen(bring(slot))))), scope),
    );
  });

  const moved = <A, E, R>(slot: Slot, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const moving = Deferred.makeUnsafe<void>();
      slot.moving = moving;
      return work.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            slot.moving = null;
            Deferred.doneUnsafe(moving, Effect.void);
          }),
        ),
      );
    });

  const touches = (slot: Slot, path: string): boolean => {
    const outputs = slot.outputs;
    if (outputs === null) return !path.split('/').some((part) => PASSED_OVER.has(part));
    if (path === '' || outputs.has(path)) return true;
    for (const output of outputs) if (output.startsWith(`${path}/`)) return true;
    return false;
  };

  const heard = (slot: Slot, event: WatchEvent): void => {
    const named = event.paths ?? [];
    if ('rescan' in event && (event.rescan !== 'rename' || named.length === 0)) {
      void forked(schedule(slot, LOST.has(event.rescan) ? POLL : SETTLE));
      return;
    }
    if (!named.some((path) => touches(slot, path))) return;
    void forked(schedule(slot, SETTLE));
  };

  const watched = Effect.fn('PluginHost.watched')(function* (slot: Slot) {
    if (slot.watch?.watching() === true) return;
    slot.watch?.close();
    const opening = watchAll([{ at: slot.root, recursive: true, required: true, listen: (event) => heard(slot, event) }]);
    slot.watch = yield* Option.isSome(watcher) ? Effect.provideService(opening, FileWatcher, watcher.value) : opening;
    if (!slot.watch.watching()) yield* schedule(slot, POLL);
  });

  const closed = Effect.fnUntraced(function* (slot: Slot) {
    const old = slot.live;
    slot.live = null;
    if (old === null) return;
    yield* drained(old, DRAIN);
    yield* Scope.close(old.scope, Exit.void);
  });

  const fell = Effect.fnUntraced(function* (slot: Slot, reason: string, since: number | null) {
    const now = yield* Clock.currentTimeMillis;
    slot.failure = reason;
    slot.restarts += 1;
    slot.failures = since !== null && now - since >= STABLE_MS ? 1 : slot.failures + 1;
    slot.gate = now + backoffOf(slot.failures);
    if (slot.standing?.process?.resident !== true) {
      slot.state = 'idle';
      return;
    }
    slot.state = 'failed';
    offers.broken(slot.id, true);
    yield* schedule(slot, backoffOf(slot.failures));
  });

  const rejected = (slot: Slot, reason: string): void => {
    slot.state = 'failed';
    slot.failure = reason;
    slot.rejected = true;
    offers.broken(slot.id, true);
  };

  const crashed = Effect.fn('PluginHost.crashed')(
    function* (slot: Slot, generation: Generation, reason: string) {
      if (slot.live !== generation) return;
      slot.live = null;
      yield* Scope.close(generation.scope, Exit.void);
      yield* fell(slot, reason, generation.startedAt);
    },
    Effect.uninterruptible,
    (work, slot) => slot.lock.withPermit(work),
  );

  const rested = Effect.fn('PluginHost.rested')(
    function* (slot: Slot, generation: Generation): Effect.fn.Return<boolean> {
      if (slot.live !== generation) return true;
      if (generation.active > 0 || generation.subscriptions > 0) return false;
      if ((yield* Clock.currentTimeMillis) - generation.lastUsed < quietMs) return false;
      yield* moved(slot, closed(slot));
      slot.state = 'idle';
      return true;
    },
    Effect.uninterruptible,
    (work, slot) => slot.lock.withPermit(work),
  );

  const quieted = Effect.fnUntraced(function* (slot: Slot, generation: Generation) {
    while (slot.live === generation) {
      const idle = generation.active === 0 && generation.subscriptions === 0;
      const left = generation.lastUsed + quietMs - (yield* Clock.currentTimeMillis);
      if (idle && left <= 0) {
        if (yield* rested(slot, generation)) return;
        continue;
      }
      yield* Effect.sleep(idle ? left : quietMs);
    }
  });

  const launched = Effect.fn('PluginHost.launch')(function* (slot: Slot, standing: Standing & { readonly process: PluginProcess }) {
    slot.state = 'starting';
    const opened = yield* Effect.result(
      openGeneration(
        {
          id: slot.id,
          root: slot.root,
          data: standing.ref.data,
          server,
          process: standing.process,
          revision: standing.revision,
          environment: standing.environment,
        },
        generations,
      ),
    );
    if (Result.isFailure(opened)) return yield* fell(slot, opened.failure.reason, null);
    const generation = opened.success;
    const difference = listingDifference(standing.tools, generation.session.descriptors);
    if (difference !== null) {
      yield* Scope.close(generation.scope, Exit.void);
      return rejected(slot, difference);
    }
    slot.live = generation;
    slot.state = 'running';
    slot.failure = undefined;
    offers.broken(slot.id, false);
    yield* Effect.forkIn(
      Deferred.await(generation.session.closed).pipe(Effect.flatMap((ended) => crashed(slot, generation, ended.message))),
      scope,
    );
    if (!standing.process.resident) yield* detached(FiberMap.run(quiets, slot.id, quieted(slot, generation)));
  });

  const unstarted = (slot: Slot) =>
    new McpConnectFailed({ server: slot.id, transport: 'stdio', reason: slot.failure ?? 'its process did not start' });

  const opened = Effect.fn('PluginHost.open')(
    function* (slot: Slot, restarts: number): Effect.fn.Return<void, McpNotConnected | McpConnectFailed> {
      if (slots.get(slot.id) !== slot) return yield* notConnected(slot);
      const live = slot.live;
      if (live !== null && alive(live)) return;
      const standing = slot.standing;
      if (standing === null || standing.process === null) return yield* notConnected(slot);
      if (slot.restarts !== restarts) return yield* unstarted(slot);
      const process = standing.process;
      yield* moved(slot, launched(slot, { ...standing, process }));
      if (slot.live === null) return yield* unstarted(slot);
    },
    Effect.uninterruptible,
    (work, slot) => slot.lock.withPermit(work),
  );

  const woken = Effect.fnUntraced(function* (slot: Slot) {
    const restarts = slot.restarts;
    const wait = slot.gate - (yield* Clock.currentTimeMillis);
    if (wait > 0) yield* Effect.sleep(wait);
    yield* opened(slot, restarts);
  });

  const retired = Effect.fnUntraced(function* (slot: Slot) {
    slot.watch?.close();
    slot.watch = null;
    yield* FiberMap.remove(quiets, slot.id);
    yield* closed(slot);
    slot.standing?.withdraw();
    slot.standing = null;
    offers.broken(slot.id, false);
    if (slots.get(slot.id) === slot) slots.delete(slot.id);
    slot.state = 'stopped';
  });

  const inspected = Effect.fnUntraced(function* (slot: Slot) {
    const plugin = yield* hosted.read(slot.id);
    slot.outputs = new Set(plugin.outputs);
    const checked = points.check(slot.id, plugin.contributes);
    if (Result.isFailure(checked)) return yield* new ContributionsRefused({ reason: checked.failure });
    return { plugin, checked: checked.success, environment: environmentOf(plugin.options, plugin.redact) };
  });

  const refresh = Effect.fn('PluginHost.refresh')(function* (slot: Slot) {
    yield* Effect.matchEffect(inspected(slot), {
      onFailure: Effect.fnUntraced(function* (failure) {
        if (failure._tag === 'PluginUnhosted') return yield* retired(slot);
        const temporary = TEMPORARY.has(failure._tag);
        if (slot.standing !== null) {
          slot.refused = failure.reason;
          if (temporary) yield* schedule(slot, POLL);
          return;
        }
        slot.state = 'failed';
        slot.failure = failure.reason;
        slot.refused = undefined;
        offers.broken(slot.id, true);
        if (temporary) {
          slot.failures += 1;
          slot.restarts += 1;
          yield* schedule(slot, backoffOf(slot.failures));
        }
      }),
      onSuccess: Effect.fnUntraced(function* ({ plugin, checked, environment }) {
        slot.refused = undefined;
        const standing = slot.standing;
        if (standing !== null && standing.revision === plugin.revision && standing.environment.fingerprint === environment.fingerprint) {
          if (slot.rejected || standing.process?.resident !== true || slot.live !== null) return;
          const wait = slot.gate - (yield* Clock.currentTimeMillis);
          if (wait > 0) return yield* schedule(slot, wait);
          const process = standing.process;
          return yield* moved(slot, launched(slot, { ...standing, process }));
        }
        const tools = checkedOf(checked, TOOLS) ?? [];
        if (
          standing !== null &&
          !slot.rejected &&
          standing.environment.fingerprint === environment.fingerprint &&
          standing.processRevision === plugin.processRevision &&
          JSON.stringify(standing.process) === JSON.stringify(plugin.process) &&
          JSON.stringify(standing.tools) === JSON.stringify(tools)
        ) {
          return yield* moved(
            slot,
            Effect.gen(function* () {
              slot.title = plugin.title;
              standing.withdraw();
              slot.standing = null;
              const ref: PluginRef = { id: slot.id, title: plugin.title, root: slot.root, data: plugin.data };
              const published = yield* Effect.result(points.publish(ref, checked, { call, callAdmitted }));
              if (Result.isFailure(published)) {
                yield* FiberMap.remove(quiets, slot.id);
                yield* closed(slot);
                slot.state = 'failed';
                slot.failure = published.failure.message;
                offers.broken(slot.id, true);
                return;
              }
              slot.standing = { ...standing, ref, revision: plugin.revision, withdraw: published.success };
            }),
          );
        }
        yield* moved(
          slot,
          Effect.gen(function* () {
            slot.title = plugin.title;
            yield* FiberMap.remove(quiets, slot.id);
            yield* closed(slot);
            slot.standing?.withdraw();
            slot.standing = null;
            slot.rejected = false;
            const ref: PluginRef = { id: slot.id, title: plugin.title, root: slot.root, data: plugin.data };
            const published = yield* Effect.result(points.publish(ref, checked, { call, callAdmitted }));
            slot.failures = 0;
            slot.gate = 0;
            if (Result.isFailure(published)) {
              slot.state = 'failed';
              slot.failure = published.failure.message;
              offers.broken(slot.id, true);
              return;
            }
            const next: Standing = {
              ref,
              revision: plugin.revision,
              processRevision: plugin.processRevision,
              process: plugin.process,
              environment,
              tools,
              withdraw: published.success,
            };
            slot.standing = next;
            slot.failure = undefined;
            offers.broken(slot.id, false);
            const process = next.process;
            if (process === null) slot.state = 'running';
            else if (process.resident) yield* launched(slot, { ...next, process });
            else slot.state = 'idle';
          }),
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
    yield* slot.lock.withPermit(Effect.uninterruptible(Effect.andThen(FiberMap.remove(pending, id), moved(slot, retired(slot)))));
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
        tools: slot.standing?.tools.filter((entry) => entry.audience !== 'tagma').length ?? 0,
        restarts: slot.restarts,
        failure: slot.failure === undefined ? undefined : clipped(slot.failure),
        refused: slot.refused === undefined ? undefined : clipped(slot.refused),
      };
    },
    standing: (id: string): boolean => slots.get(id)?.standing != null,
    hosting: (): readonly string[] => [...slots.keys()],
    hosts: (id: string): boolean => slots.has(id),
    title: (id: string): string | null => slots.get(id)?.title ?? null,
    ensure: Effect.fnUntraced(function* (id: string, root: string, projects: readonly number[]) {
      const standing = slots.get(id);
      if (standing?.root === root) {
        standing.projects = projects;
        return;
      }
      if (standing !== undefined) yield* stop(id);
      yield* bring(made(id, root, projects));
    }),
    reread: (id: string): Effect.Effect<void> => {
      const slot = slots.get(id);
      return slot === undefined ? Effect.void : schedule(slot, Duration.zero);
    },
    stop,
    call,
    callAdmitted,
    read: Effect.fn('PluginHost.read')((id: string, uri: string, options: McpCallOptions) =>
      serving(id, (generation, slot) =>
        within(generation, id, slot.state, (session) => session.readResource(uri, withProjects(slot, options))),
      ),
    ),
    subscribe: Effect.fn('PluginHost.subscribe')((id: string, uri: string, options: McpCallOptions) =>
      serving(
        id,
        (generation, slot): Effect.Effect<Stream.Stream<McpResourceUpdated>, McpResourceFailed | McpNotConnected, Scope.Scope> => {
          if (!alive(generation)) return Effect.fail(notConnected(slot));
          return Effect.andThen(subscribed(generation), generation.session.subscribeResource(uri, withProjects(slot, options)));
        },
      ),
    ),
  };
});
