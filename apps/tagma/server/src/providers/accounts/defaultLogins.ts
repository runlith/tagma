import { AccountKey } from '@runlith/llm/models/authStatus';
import type { CliHarnessProvider, HarnessLoginStatus } from '@runlith/tagma/adapter/provider';
import { dirname, join, relative, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { Clock, Context, Deferred, Effect, Exit, FileSystem, Layer, Option, PubSub, Queue, Scope, Semaphore, Stream } from 'effect';
import { FileWatcher, WatchRefused } from '../../platform/contract/service/watch.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { AccountCli, LoginPlaces, type LoginEnvironment } from '../contract/service/cli.js';
import { ProviderRegistry } from '../contract/service/registry.js';
import type { DirectoryAccount } from '../contract/wire/harnessAccounts.js';
import { credentialRefusal } from '../credentials/refusal.js';
import { HarnessDirectories, type HarnessDirectoryStore } from './harnessRows.js';

export const DEFAULT_LOGIN = AccountKey.make('default');

export const LISTED_MS = 30_000;

type Reading = { readonly read: Effect.Effect<DirectoryAccount | null, GateRefusal>; readonly forget: Effect.Effect<void> };

export const makeDefaultLoginBook = (input: { readonly rows: HarnessDirectoryStore; readonly cli: AccountCli['Service'] }) => {
  const { rows, cli } = input;
  const readings = new WeakMap<CliHarnessProvider, Reading>();
  const places = new WeakMap<CliHarnessProvider, string | null>();
  const locks = new WeakMap<CliHarnessProvider, Map<string | null, Semaphore.Semaphore>>();
  let revision = 0;
  const directoryOf = (registration: CliHarnessProvider) => places.get(registration) ?? null;
  const stored = (registration: CliHarnessProvider, directory = directoryOf(registration)) =>
    Effect.map(rows.of(registration.id), (held) => held.find((row) => row.directory === directory) ?? null).pipe(
      Effect.mapError((cause) => credentialRefusal('read the CLI login', cause)),
    );
  const keep = Effect.fnUntraced(function* (registration: CliHarnessProvider, row: DirectoryAccount, previous: DirectoryAccount | null) {
    if (previous !== null && JSON.stringify(previous) === JSON.stringify(row)) return previous;
    yield* rows.keep(registration.id, row);
    revision += 1;
    return row;
  });
  const readStatus = Effect.fn('DefaultLogins.read')(
    function* (registration: CliHarnessProvider, requested: boolean, directory = directoryOf(registration)) {
      const auth = registration.accounts;
      if (auth === undefined) return null;
      const previous = yield* stored(registration, directory);
      if (!requested && auth.discovery === undefined && previous?.requested !== true) return null;
      const standing: DirectoryAccount = previous ?? {
        key: directory === null ? DEFAULT_LOGIN : AccountKey.make(crypto.randomUUID()),
        label: registration.label,
        machine: rows.machine,
        directory,
        addedAt: yield* Clock.currentTimeMillis,
        signed: false,
        pending: false,
      };
      const read = yield* cli
        .run({ ...auth.status, entries: registration.environment(directory), timeoutMs: 10_000, located: auth.discovery !== undefined })
        .pipe(
          Effect.flatMap(auth.loggedIn),
          Effect.match({
            onFailure: (cause): HarnessLoginStatus => ({ kind: 'unreadable', reason: cause.message }),
            onSuccess: (answer) => answer,
          }),
        );
      const problem = read.kind === 'signed-in' ? null : read.kind === 'signed-out' ? { kind: 'signed-out' as const } : read;
      const latest = (yield* stored(registration, directory)) ?? standing;
      const next = yield* keep(
        registration,
        {
          ...latest,
          signed: read.kind === 'unreadable' ? latest.signed : read.kind === 'signed-in',
          label: read.kind === 'signed-in' ? read.label : latest.label,
          requested:
            latest.requested === true || read.kind === 'signed-in' || (requested && auth.discovery === undefined) ? true : undefined,
          observed: auth.discovery === undefined ? latest.observed : true,
          problem,
        },
        previous === null ? null : latest,
      );
      if (read.kind === 'unreadable' && requested)
        return yield* new GateRefusal('login-unreadable', read.reason, ['check the CLI authentication status and retry']);
      return next;
    },
    Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('keep the CLI login', cause))),
  );
  const lock = Effect.fnUntraced(function* (registration: CliHarnessProvider, directory: string | null) {
    let held = locks.get(registration);
    if (held === undefined) {
      held = new Map();
      locks.set(registration, held);
    }
    const current = held.get(directory);
    if (current !== undefined) return current;
    const made = yield* Semaphore.make(1);
    const kept = held.get(directory) ?? made;
    held.set(directory, kept);
    return kept;
  });
  const carried = (registration: CliHarnessProvider, requested: boolean, directory = directoryOf(registration)) =>
    Effect.flatMap(lock(registration, directory), (gate) => gate.withPermit(readStatus(registration, requested, directory)));
  const reading = Effect.fnUntraced(function* (registration: CliHarnessProvider) {
    const standing = readings.get(registration);
    if (standing !== undefined) return standing;
    const [read, forget] = yield* Effect.cachedInvalidateWithTTL(carried(registration, false), LISTED_MS);
    const made = readings.get(registration) ?? { read, forget };
    readings.set(registration, made);
    return made;
  });
  return {
    listed: (registration: CliHarnessProvider) =>
      registration.accounts?.discovery === undefined ? Effect.flatMap(reading(registration), ({ read }) => read) : stored(registration),
    current: (registration: CliHarnessProvider) =>
      Effect.flatMap(reading(registration), ({ forget }) => carried(registration, true).pipe(Effect.ensuring(forget))),
    observe: (registration: CliHarnessProvider, directory?: string | null) => carried(registration, false, directory),
    directoryOf,
    place: (registration: CliHarnessProvider, directory: string | null) => places.set(registration, directory),
    revision: () => revision,
    ready: Effect.void as Effect.Effect<void>,
    focus: Effect.void as Effect.Effect<void>,
    changes: Stream.empty as Stream.Stream<string>,
  };
};
export type DefaultLoginBook = ReturnType<typeof makeDefaultLoginBook>;

export class DefaultLogins extends Context.Service<DefaultLogins, DefaultLoginBook>()('tagma/providers/DefaultLogins') {}

export const defaultLoginsLayer = Layer.effect(
  DefaultLogins,
  Effect.gen(function* () {
    const rows = yield* HarnessDirectories;
    const cli = yield* AccountCli;
    const registry = yield* ProviderRegistry;
    const bound = yield* Effect.serviceOption(LoginPlaces);
    const book = makeDefaultLoginBook({ rows, cli });
    if (Option.isNone(bound)) return book;
    const places = bound.value;
    const files = yield* FileSystem.FileSystem;
    const watching = yield* Effect.serviceOption(FileWatcher);
    if (Option.isNone(watching)) return yield* Effect.die('CLI login discovery requires the file watcher.');
    const watcher = watching.value;
    const scope = yield* Effect.scope;
    const ready = yield* Deferred.make<void>();
    const moved = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1, replay: 1 }), PubSub.shutdown);
    const pending = new Set<string>();
    const declaring = () =>
      registry
        .current()
        .harnesses.filter(
          (provider): provider is CliHarnessProvider => provider.auth === 'cli' && provider.accounts?.discovery !== undefined,
        );
    places.retain(declaring().map((provider) => provider.accounts!.discovery!.variable));
    const watches = new Set<string>();
    const observed = new Set<string>();
    const signed = new Set<string>();
    let profilePending = true;
    const scans = yield* Semaphore.make(1);

    const read = Effect.fn('DefaultLogins.observe')(function* (provider: CliHarnessProvider, directory = book.directoryOf(provider)) {
      const before = book.revision();
      const answer = yield* book.observe(provider, directory);
      if (directory === book.directoryOf(provider)) {
        observed.add(provider.id);
        if (answer?.signed && answer.problem == null) signed.add(provider.id);
        else signed.delete(provider.id);
      }
      if (book.revision() !== before) {
        pending.add(provider.id);
        yield* PubSub.publish(moved, undefined);
      }
      if (answer?.problem?.kind === 'unreadable')
        yield* Effect.logWarning('the CLI login observation is unreadable', { provider: provider.id, reason: answer.problem.reason });
    });

    const fingerprint = Effect.fn('DefaultLogins.fingerprint')((target: string) =>
      Effect.tryPromise(() => stat(target)).pipe(
        Effect.match({
          onSuccess: (info) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
          onFailure: (cause) => `unreadable:${cause.message}`,
        }),
      ),
    );
    const watch = Effect.fn('DefaultLogins.watch')(function* (provider: CliHarnessProvider, directory: string | null) {
      const discovery = provider.accounts!.discovery!;
      const base = directory ?? discovery.directory;
      for (const file of discovery.files) {
        const target = resolve(join(base, file));
        const key = `${provider.id}\0${target}`;
        if (watches.has(key)) continue;
        watches.add(key);
        let stamp = yield* fingerprint(target);
        const refresh = Effect.fnUntraced(function* () {
          let next = yield* fingerprint(target);
          while (next !== stamp) {
            stamp = next;
            yield* read(provider, directory);
            next = yield* fingerprint(target);
          }
        });
        const events = yield* Effect.acquireRelease(Queue.make<string | null>({ capacity: 1, strategy: 'sliding' }), Queue.shutdown);
        const open = Effect.fnUntraced(function* () {
          let root = dirname(target);
          while (!(yield* files.exists(root))) {
            const parent = dirname(root);
            if (parent === root) break;
            root = parent;
          }
          const direct = root === dirname(target);
          const name = relative(root, target).split('/')[0]!;
          let active = true;
          const lost = (reason: string) => {
            if (!active) return;
            active = false;
            Queue.offerUnsafe(events, reason);
          };
          const subscription = yield* watcher.subscribe(
            root,
            { recursive: false, ignore: [] },
            {
              heard: (changes) => {
                if (active && changes.some((change) => change.path === name || change.path === join(root, name)))
                  Queue.offerUnsafe(events, null);
              },
              dropped: lost,
              ended: lost,
            },
          );
          const close = Effect.andThen(
            Effect.sync(() => {
              active = false;
            }),
            subscription.close,
          );
          return { direct, close };
        });
        let subscription = yield* Effect.acquireRelease(open(), (opened) => opened.close);
        yield* refresh();
        yield* Effect.forkIn(
          Effect.gen(function* () {
            for (;;) {
              const reason = yield* Queue.take(events);
              if (reason !== null) return yield* new WatchRefused({ message: reason });
              yield* refresh();
              if (!subscription.direct) {
                yield* subscription.close;
                subscription = yield* Effect.acquireRelease(open(), (opened) => opened.close);
                yield* refresh();
              }
            }
          }).pipe(
            Effect.catchTags({
              GateRefusal: (cause) =>
                Effect.logWarning('the CLI login watch could not keep its observation', { provider: provider.id, target, cause }),
              PlatformError: (cause) =>
                Effect.logWarning('the CLI login directory cannot be watched', { provider: provider.id, target, cause }),
              WatchRefused: (cause) => Effect.logWarning('the CLI login watch was lost', { provider: provider.id, target, cause }),
            }),
            Effect.ensuring(
              Effect.sync(() => {
                watches.delete(key);
                signed.delete(provider.id);
              }),
            ),
          ),
          scope,
        );
      }
    });

    const prepare = Effect.fnUntraced(function* (provider: CliHarnessProvider, environment: LoginEnvironment) {
      const directory = environment.variables[provider.accounts!.discovery!.variable] ?? null;
      if (directory !== book.directoryOf(provider)) {
        observed.delete(provider.id);
        signed.delete(provider.id);
      }
      book.place(provider, directory);
      const persisted = (yield* rows.of(provider.id)).find((row) => row.directory === directory);
      if (persisted?.signed && persisted.problem == null) signed.add(provider.id);
      yield* watch(provider, directory).pipe(Effect.provideService(Scope.Scope, scope));
    });
    const settle = Effect.fnUntraced(function* () {
      const providers = declaring();
      const installed = yield* Effect.forEach(providers, (provider) =>
        Effect.map(cli.installed(provider.accounts!.status.program), (state) => ({ provider, state })),
      );
      const first = installed.find(({ state }) => state._tag !== 'Missing');
      if (
        (first !== undefined && signed.has(first.provider.id)) ||
        (!profilePending && installed.every(({ provider, state }) => state._tag === 'Missing' || observed.has(provider.id)))
      )
        yield* Deferred.succeed(ready, undefined);
    });
    const start = Effect.gen(function* () {
      const immediate = yield* places.now;
      profilePending = immediate.reading;
      yield* Effect.forEach(declaring(), (provider) => prepare(provider, immediate));
      yield* settle();
      yield* Effect.forEach(
        declaring(),
        (provider) =>
          Effect.gen(function* () {
            const installed = yield* cli.installed(provider.accounts!.status.program);
            if (installed._tag === 'Found' && !observed.has(provider.id)) {
              yield* read(provider);
              yield* settle();
            }
          }),
        { concurrency: 3 },
      );
      if (immediate.reading) {
        const profile = yield* places.ready;
        profilePending = false;
        yield* Effect.forEach(
          declaring(),
          (provider) =>
            Effect.gen(function* () {
              const previous = immediate.variables[provider.accounts!.discovery!.variable] ?? null;
              const directory = profile.variables[provider.accounts!.discovery!.variable] ?? null;
              yield* prepare(provider, profile);
              if (previous !== directory) observed.delete(provider.id);
              if (!observed.has(provider.id) && (yield* cli.installed(provider.accounts!.status.program))._tag === 'Found')
                yield* read(provider);
              yield* settle();
            }),
          { concurrency: 3 },
        );
      }
      yield* settle();
    }).pipe(
      scans.withPermit,
      Effect.tapCause((cause) => Effect.logWarning('CLI login discovery did not complete', { cause })),
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Deferred.succeed(ready, undefined) : Effect.void)),
    );
    const revisit = Effect.gen(function* () {
      const environment = yield* places.now;
      profilePending = environment.reading;
      places.retain(declaring().map((provider) => provider.accounts!.discovery!.variable));
      yield* Effect.forEach(
        declaring(),
        (provider) =>
          Effect.gen(function* () {
            yield* prepare(provider, environment);
            if (!observed.has(provider.id) && (yield* cli.installed(provider.accounts!.status.program))._tag === 'Found')
              yield* read(provider);
            yield* settle();
          }),
        { concurrency: 3 },
      );
    }).pipe(
      scans.withPermit,
      Effect.tapCause((cause) => Effect.logWarning('CLI login discovery could not follow an installation change', { cause })),
    );
    yield* Effect.forkIn(
      Stream.runForEach(cli.changes, () => revisit),
      scope,
    );
    yield* Effect.forkIn(start, scope);
    return {
      ...book,
      ready: Deferred.await(ready),
      focus: Effect.gen(function* () {
        const environment = yield* places.ready;
        yield* Effect.forEach(
          declaring(),
          (provider) =>
            Effect.gen(function* () {
              if (signed.has(provider.id)) return;
              yield* prepare(provider, environment);
              if ((yield* cli.installed(provider.accounts!.status.program))._tag === 'Found') yield* read(provider);
            }),
          { concurrency: 3 },
        );
      }).pipe(
        scans.withPermit,
        Effect.matchEffect({
          onFailure: (cause) => Effect.logWarning('CLI login focus observation could not read its rows', { cause }),
          onSuccess: () => Effect.void,
        }),
        Effect.withSpan('DefaultLogins.focus'),
      ),
      changes: Stream.fromPubSub(moved).pipe(
        Stream.mapEffect(() =>
          Effect.sync(() => {
            const providers = [...pending];
            pending.clear();
            return providers;
          }),
        ),
        Stream.flatMap((providers) => Stream.fromIterable(providers)),
      ),
    };
  }),
);
