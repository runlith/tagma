import { afterAll, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { it } from '@runlith/effect-test';
import { Clock, Context, Deferred, Effect, Exit, Fiber, Queue, Schema, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { AccountCli } from '../contract/service/cli.js';
import { DefaultAccounts } from '../contract/service/accounts.js';
import { AccountQuota } from '../contract/service/quota.js';
import { ProviderRegistry } from '../contract/service/registry.js';
import { ProviderCredentials } from '../contract/service/credentials.js';
import { providerCatalogOf, staticRegistry } from '../testing/registry.js';
import { testCredentials, testTokens } from '../testing/tokens.js';
import { makeFileTokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { adapter as cursorAdapter } from '@runlith/adapter-cursor/adapter';
import { makeHarnessAccountBook, type HarnessAccountBook } from './harnessAccounts.js';
import { HarnessAccounts } from '../contract/service/harness.js';
import { DEFAULT_LOGIN, DefaultLogins, makeDefaultLoginBook, LISTED_MS, type DefaultLoginBook } from './defaultLogins.js';
import { harnessStored } from './harnessStored.js';
import { harnessSignIns } from './harnessSignIns.js';
import { SignIns } from '../contract/service/signIns.js';
import { PROVIDER_PAIRS } from '../operations.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { HarnessDirectories, type HarnessDirectoryStore, makeHarnessDirectoryStore } from './harnessRows.js';

const home = await mkdtemp(join(tmpdir(), 'harness-accounts-'));
afterAll(() => rm(home, { recursive: true, force: true }));
const provider: HarnessProvider = {
  id: 'cli-fixture',
  label: 'Fixture',
  auth: 'cli',
  kind: 'harness',
  icon: '',
  models: { model: { label: 'Model', capacity: { context: 100_000 }, capabilities: ['text'], reasoning: [], defaultReasoning: null } },
  defaultTextModel: 'model',
  cacheLifetime: { promisedSeconds: null, prior: null },
  environment: (directory) => [
    { _tag: 'Unset', name: 'KEY' },
    directory === null ? { _tag: 'Unset', name: 'CONFIG_ROOT' } : { _tag: 'Set', name: 'CONFIG_ROOT', value: directory },
  ],
  accounts: {
    directory: 'fixture',
    login: { program: 'fixture', args: ['login'] },
    status: { program: 'fixture', args: ['status'] },
    loggedIn: (output) =>
      Effect.succeed(
        output.code === 0 ? { kind: 'signed-in' as const, label: output.stdout || 'Signed in' } : { kind: 'signed-out' as const },
      ),
  },
};
const registry: ProviderRegistry['Service'] = staticRegistry(providerCatalogOf([provider]));
const cli: AccountCli['Service'] = {
  installed: () => Effect.succeed({ _tag: 'Found' } as const),
  changes: Stream.empty,
  run: () => Effect.succeed({ stdout: '', stderr: '', code: 0 }),
  login: () =>
    Effect.sync(() => Schema.decodeUnknownSync(ExecutionRef)({ installation: 'fixture', execution: crypto.randomUUID(), incarnation: 1 })),
  ended: () => Effect.never,
  stop: () => Effect.die('this scenario cancels no login terminal'),
};
const quotaInto = (refreshed: Queue.Queue<string | undefined>): AccountQuota['Service'] => ({
  table: () => Effect.die('the book reads no quota table'),
  observe: () => Effect.void,
  merge: () => Effect.void,
  fail: () => Effect.void,
  refresh: (provider) => Effect.asVoid(Queue.offer(refreshed, provider)),
  changes: Stream.empty,
});
const quiet: AccountQuota['Service'] = {
  table: () => Effect.die('the book reads no quota table'),
  observe: () => Effect.void,
  merge: () => Effect.void,
  fail: () => Effect.void,
  refresh: () => Effect.void,
  changes: Stream.empty,
};
const bookOf = Effect.fnUntraced(function* (
  rows: HarnessDirectoryStore,
  chosen: DefaultAccounts['Service'],
  port: AccountCli['Service'],
  quota = quiet,
  providedLogins?: DefaultLoginBook,
) {
  const logins =
    providedLogins ??
    (yield* Effect.provide(makeDefaultLoginBook, Context.make(HarnessDirectories, rows).pipe(Context.add(AccountCli, port))));
  return yield* makeHarnessAccountBook.pipe(
    Effect.provide(
      Context.make(HarnessDirectories, rows).pipe(
        Context.add(ProviderCredentials, testCredentials(testTokens(join(home, 'tokens.json')))),
        Context.add(ProviderRegistry, registry),
        Context.add(DefaultAccounts, chosen),
        Context.add(AccountCli, port),
        Context.add(DefaultLogins, logins),
        Context.add(AccountQuota, quota),
      ),
    ),
  );
});

const ordinary = () => Effect.die('this scenario uses only the official CLI sign-in');
const signing = (book: HarnessAccountBook) =>
  harnessSignIns(
    SignIns.of({
      status: () => Effect.succeed({}),
      begin: ordinary,
      complete: ordinary,
      remove: ordinary,
      rename: ordinary,
      keepCredential: ordinary,
      saveConsoleKey: ordinary,
      removeConsoleKey: ordinary,
      consoleKeys: ordinary,
    }),
    book,
    registry,
  );
const operator: Caller = { actor: { kind: 'operator' }, files: null };
const operations = (book: HarnessAccountBook) => {
  const context = Context.make(SignIns, signing(book)).pipe(Context.add(HarnessAccounts, book));
  return <A, E>(work: Effect.Effect<A, E, SignIns | HarnessAccounts>) => Effect.provide(work, context);
};

const defaults = (): DefaultAccounts['Service'] => {
  let account: AccountKey | null = null;
  let revision = 0;
  const save = (_provider: string, next: string | null) =>
    Effect.sync(() => ({ account: (account = next === null ? null : AccountKey.make(next)), revision: ++revision }));
  return {
    defaultAccount: () => Effect.sync(() => ({ account, revision })),
    saveDefaultAccount: save,
    settleDefaultAccount: (_unit, provider, next) => save(provider, next),
    forgetAccount: (provider, key) => (account === key ? save(provider, null) : Effect.succeed({ account, revision })),
    adoptDefaultAccount: (_provider, next) =>
      Effect.sync(() => {
        if (account === null) account = next;
      }),
    defaultAccountMoved: Stream.empty,
  };
};

it.effect('a key harness launches with the pinned key instead of the default and refuses an expired key', () =>
  Effect.gen(function* () {
    const cursor = cursorAdapter({ product: { mcpServer: 'test', client: { name: 'test', version: '1' } }, instances: [] })[0]!;
    if (cursor.kind !== 'harness' || cursor.auth !== 'api-key') return yield* Effect.die('expected key harness');
    const tokens = makeFileTokenStore({ path: join(home, 'harness-keys.json'), schemes: () => cursor.accounts, wire: vendorWire });
    const now = yield* Clock.currentTimeMillis;
    const a = yield* tokens.add('cursor', { accessToken: 'key-a', refreshToken: null, expiresAt: now + 1_000, email: 'a@example.com' });
    const b = yield* tokens.add('cursor', { accessToken: 'key-b', refreshToken: null, expiresAt: null, email: 'b@example.com' });
    const rows = makeHarnessDirectoryStore({ home: join(home, 'key-harness'), machine: 'machine' });
    const logins = yield* Effect.provide(makeDefaultLoginBook, Context.make(HarnessDirectories, rows).pipe(Context.add(AccountCli, cli)));
    const book = yield* makeHarnessAccountBook.pipe(
      Effect.provide(
        Context.make(HarnessDirectories, rows).pipe(
          Context.add(ProviderCredentials, testCredentials(tokens)),
          Context.add(ProviderRegistry, staticRegistry(providerCatalogOf([cursor]))),
          Context.add(DefaultAccounts, { ...defaults(), defaultAccount: () => Effect.succeed({ account: b, revision: 1 }) }),
          Context.add(AccountCli, cli),
          Context.add(DefaultLogins, logins),
          Context.add(AccountQuota, quiet),
        ),
      ),
    );
    expect((yield* book.launch('cursor', a))?.entries).toContainEqual({ _tag: 'Set', name: 'CURSOR_API_KEY', value: 'key-a' });
    expect((yield* book.launch('cursor'))?.entries).toContainEqual({ _tag: 'Set', name: 'CURSOR_API_KEY', value: 'key-b' });
    yield* TestClock.adjust('1 second');
    expect(yield* Effect.flip(book.launch('cursor', a))).toMatchObject({ code: 'credential-reconnect' });
  }),
);

it.effect('the login terminal ending settles the sign-in: a signed CLI completes the account, an unsigned one drops the new account', () =>
  Effect.gen(function* () {
    const rows = makeHarnessDirectoryStore({ home: join(home, 'settled'), machine: 'machine' });
    const ended = yield* Deferred.make<void>();
    let signed = true;
    const watched: AccountCli['Service'] = {
      installed: cli.installed,
      changes: Stream.empty,
      run: () => Effect.sync(() => ({ stdout: '', stderr: '', code: signed ? 0 : 1 })),
      login: cli.login,
      stop: cli.stop,
      ended: () => Deferred.await(ended),
    };
    const refreshed = yield* Queue.unbounded<string | undefined>();
    const book = yield* bookOf(rows, defaults(), watched, quotaInto(refreshed));
    const kept = yield* book.begin(provider.id, 1);
    expect(yield* book.status(provider.id)).toMatchObject([{ account: kept.account, pending: true }]);
    yield* Deferred.succeed(ended, undefined);
    expect(yield* Queue.take(refreshed)).toBe(provider.id);
    expect(yield* book.status(provider.id)).toMatchObject([{ account: kept.account, pending: false, label: 'Signed in', default: true }]);

    signed = false;
    const dropped = yield* book.begin(provider.id, 1);
    expect(yield* Queue.take(refreshed)).toBe(provider.id);
    expect(dropped.account).not.toBe(kept.account);
    expect((yield* rows.of(provider.id)).map((row) => row.key)).toEqual([kept.account]);
  }),
);

it.effect('the sign-in operations resume a held login after its account owner restarts and settle only on the terminal ending', () =>
  Effect.gen(function* () {
    const rows = makeHarnessDirectoryStore({ home: join(home, 'resumed'), machine: 'machine' });
    const ended = yield* Deferred.make<void>();
    const refreshed = yield* Queue.unbounded<string | undefined>();
    const watched: AccountCli['Service'] = { ...cli, ended: () => Deferred.await(ended) };
    const chosen = defaults();
    const caller: Caller = { actor: { kind: 'operator' }, files: null };
    const call = <A, E>(work: Effect.Effect<A, E, SignIns>, signIns: SignIns['Service']) => Effect.provideService(work, SignIns, signIns);
    const firstScope = yield* Scope.fork(yield* Effect.scope);
    const first = yield* bookOf(rows, chosen, watched, quotaInto(refreshed)).pipe(Scope.provide(firstScope));
    const begun = yield* call(
      PROVIDER_PAIRS.begin_sign_in.body.execute({ provider: provider.id, projectId: 5, method: 'external-cli' }, undefined, caller),
      signing(first),
    );
    expect(begun.flow.flow).toBe('external-cli');
    yield* Scope.close(firstScope, Exit.void);
    const second = yield* bookOf(
      makeHarnessDirectoryStore({ home: rows.home, machine: rows.machine }),
      chosen,
      watched,
      quotaInto(refreshed),
    );
    const resumed = signing(second);
    const waiting = yield* call(PROVIDER_PAIRS.read_sign_in.body.execute({}, undefined, caller), resumed);
    expect(waiting.providers[provider.id]).toMatchObject([{ pending: true }]);
    yield* Deferred.succeed(ended, undefined);
    yield* Queue.take(refreshed);
    const settled = yield* call(PROVIDER_PAIRS.read_sign_in.body.execute({}, undefined, caller), resumed);
    expect(settled.providers[provider.id]).toMatchObject([{ pending: false, default: true, label: 'Signed in' }]);
  }),
);

it.effect('a refused stop after late successful status keeps cancellation durable until restart confirms the stop', () =>
  Effect.gen(function* () {
    const rows = makeHarnessDirectoryStore({ home: join(home, 'cancel-late'), machine: 'machine' });
    const reading = yield* Deferred.make<void>();
    const ended = yield* Deferred.make<void>();
    const stopping = yield* Deferred.make<void>();
    const stopped = yield* Deferred.make<void>();
    const refreshed = yield* Queue.unbounded<string | undefined>();
    const result = yield* Deferred.make<{ stdout: string; stderr: string; code: number }>();
    let alive = false;
    let refuseStop = true;
    const port: AccountCli['Service'] = {
      ...cli,
      login: (command, project) =>
        cli.login(command, project).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              alive = true;
            }),
          ),
        ),
      run: () => Effect.andThen(Deferred.succeed(reading, undefined), Deferred.await(result)),
      ended: () => Deferred.await(ended),
      stop: () =>
        Effect.andThen(Deferred.succeed(stopping, undefined), Deferred.await(stopped)).pipe(
          Effect.andThen(
            Effect.suspend(() =>
              refuseStop
                ? Effect.fail(new GateRefusal('account-cli-failed', 'cleanup is unproved', ['retry cancellation']))
                : Effect.sync(() => {
                    alive = false;
                  }),
            ),
          ),
        ),
    };
    const chosen = defaults();
    const firstScope = yield* Scope.fork(yield* Effect.scope);
    const book = yield* bookOf(rows, chosen, port, quotaInto(refreshed)).pipe(Scope.provide(firstScope));
    const call = operations(book);
    const started = yield* call(
      PROVIDER_PAIRS.begin_sign_in.body.execute({ provider: provider.id, projectId: 5, method: 'external-cli' }, undefined, operator),
    );
    if (started.flow.flow !== 'external-cli') return yield* Effect.die('expected a CLI login');
    const { account, execution } = started.flow;
    yield* Deferred.succeed(ended, undefined);
    yield* Deferred.await(reading);
    const cancelling = yield* Effect.forkScoped(
      call(PROVIDER_PAIRS.cancel_cli_sign_in.body.execute({ provider: provider.id, account, execution }, undefined, operator)),
    );
    yield* Deferred.await(stopping);
    yield* Deferred.succeed(result, { stdout: 'late@example.test', stderr: '', code: 0 });
    expect(
      yield* Effect.flip(call(PROVIDER_PAIRS.complete_sign_in.body.execute({ provider: provider.id, account }, undefined, operator))),
    ).toMatchObject({ code: 'no-sign-in' });
    yield* Deferred.succeed(stopped, undefined);
    expect(yield* Effect.flip(Fiber.join(cancelling))).toMatchObject({ code: 'account-cli-failed' });
    expect(
      yield* Effect.flip(call(PROVIDER_PAIRS.complete_sign_in.body.execute({ provider: provider.id, account }, undefined, operator))),
    ).toMatchObject({ code: 'no-sign-in' });
    expect(yield* rows.of(provider.id)).toMatchObject([{ key: account, pending: true, login: { cancelled: true } }]);
    yield* Scope.close(firstScope, Exit.void);
    refuseStop = false;
    const restored = yield* bookOf(
      makeHarnessDirectoryStore({ home: rows.home, machine: rows.machine }),
      chosen,
      port,
      quotaInto(refreshed),
    );
    yield* Queue.take(refreshed);
    expect(alive).toBe(false);
    expect((yield* operations(restored)(PROVIDER_PAIRS.read_sign_in.body.execute({}, undefined, operator))).providers[provider.id]).toEqual(
      [],
    );
    expect((yield* chosen.defaultAccount(provider.id)).account).toBeNull();
  }),
);

it.effect('Cancel of an existing attempt does not wait for an unrelated login start to answer', () =>
  Effect.gen(function* () {
    const rows = makeHarnessDirectoryStore({ home: join(home, 'cancel-independent'), machine: 'machine' });
    const entering = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const stopped = yield* Deferred.make<void>();
    let starts = 0;
    const alive = new Set<string>();
    const port: AccountCli['Service'] = {
      ...cli,
      login: Effect.fnUntraced(function* (command, project) {
        if (++starts === 2) {
          yield* Deferred.succeed(entering, undefined);
          yield* Deferred.await(release);
        }
        const execution = yield* cli.login(command, project);
        alive.add(execution.execution);
        return execution;
      }),
      stop: (execution) =>
        Effect.sync(() => {
          alive.delete(execution.execution);
        }).pipe(Effect.andThen(Effect.asVoid(Deferred.succeed(stopped, undefined)))),
    };
    const book = yield* bookOf(rows, defaults(), port);
    const call = operations(book);
    const old = yield* call(
      PROVIDER_PAIRS.begin_sign_in.body.execute({ provider: provider.id, projectId: 5, method: 'external-cli' }, undefined, operator),
    );
    if (old.flow.flow !== 'external-cli') return yield* Effect.die('expected a CLI login');
    const { account, execution } = old.flow;
    const starting = yield* Effect.forkScoped(
      call(PROVIDER_PAIRS.begin_sign_in.body.execute({ provider: provider.id, projectId: 5, method: 'external-cli' }, undefined, operator)),
    );
    yield* Deferred.await(entering);
    const cancelling = yield* Effect.forkScoped(
      call(PROVIDER_PAIRS.cancel_cli_sign_in.body.execute({ provider: provider.id, account, execution }, undefined, operator)),
    );
    yield* Deferred.await(stopped);
    expect((yield* Fiber.join(cancelling)).status).toBe('cancelled');
    expect((yield* rows.of(provider.id)).some((row) => row.key === account)).toBe(false);
    const pending = (yield* call(PROVIDER_PAIRS.read_sign_in.body.execute({}, undefined, operator))).providers[provider.id]!;
    yield* call(PROVIDER_PAIRS.remove_account.body.execute({ provider: provider.id, account: pending[0]!.account }, undefined, operator));
    yield* Deferred.succeed(release, undefined);
    expect(yield* Effect.flip(Fiber.join(starting))).toMatchObject({ code: 'unknown-account' });
    expect(alive.size).toBe(0);
  }),
);

it.effect('a refused Cancel survives restart, preserves the reconnect account and cannot cancel a newer attempt', () =>
  Effect.gen(function* () {
    const rows = makeHarnessDirectoryStore({ home: join(home, 'cancel-reconnect'), machine: 'machine' });
    const key = AccountKey.make('existing');
    yield* rows.keep(provider.id, {
      key,
      label: 'old@example.test',
      machine: 'machine',
      directory: join(rows.home, 'profile'),
      addedAt: 1,
      signed: true,
      pending: false,
    });
    const chosen = defaults();
    yield* chosen.saveDefaultAccount(provider.id, key);
    const refreshed = yield* Queue.unbounded<string | undefined>();
    let canStop = false;
    let alive = true;
    const port: AccountCli['Service'] = {
      ...cli,
      stop: () =>
        canStop
          ? Effect.sync(() => {
              alive = false;
            })
          : Effect.fail(new GateRefusal('account-cli-failed', 'host unavailable', ['retry cancellation'])),
    };
    const firstScope = yield* Scope.fork(yield* Effect.scope);
    const first = yield* bookOf(rows, chosen, port, quotaInto(refreshed)).pipe(Scope.provide(firstScope));
    const start = yield* operations(first)(
      PROVIDER_PAIRS.begin_sign_in.body.execute(
        { provider: provider.id, projectId: 5, account: key, method: 'external-cli' },
        undefined,
        operator,
      ),
    );
    if (start.flow.flow !== 'external-cli') return yield* Effect.die('expected a CLI login');
    const cancel = { provider: provider.id, account: key, execution: start.flow.execution };
    expect(
      yield* Effect.flip(operations(first)(PROVIDER_PAIRS.cancel_cli_sign_in.body.execute(cancel, undefined, operator))),
    ).toMatchObject({ code: 'account-cli-failed' });
    expect(yield* rows.of(provider.id)).toMatchObject([{ signed: true, pending: true, login: { cancelled: true } }]);
    yield* Scope.close(firstScope, Exit.void);
    canStop = true;
    const restored = yield* bookOf(
      makeHarnessDirectoryStore({ home: rows.home, machine: rows.machine }),
      chosen,
      port,
      quotaInto(refreshed),
    );
    yield* Queue.take(refreshed);
    expect(alive).toBe(false);
    expect(yield* rows.of(provider.id)).toMatchObject([{ key, label: 'old@example.test', signed: true, pending: false }]);
    expect((yield* chosen.defaultAccount(provider.id)).account).toBe(key);
    const next = yield* operations(restored)(
      PROVIDER_PAIRS.begin_sign_in.body.execute(
        { provider: provider.id, projectId: 5, account: key, method: 'external-cli' },
        undefined,
        operator,
      ),
    );
    if (next.flow.flow !== 'external-cli') return yield* Effect.die('expected a newer CLI login');
    alive = true;
    expect(
      yield* Effect.flip(operations(restored)(PROVIDER_PAIRS.cancel_cli_sign_in.body.execute(cancel, undefined, operator))),
    ).toMatchObject({ code: 'no-sign-in' });
    expect(alive).toBe(true);
    yield* operations(restored)(
      PROVIDER_PAIRS.cancel_cli_sign_in.body.execute({ ...cancel, execution: next.flow.execution }, undefined, operator),
    );
    expect(yield* rows.of(provider.id)).toMatchObject([{ key, signed: true, pending: false, label: 'old@example.test' }]);
  }),
);

it.effect('a reconnect whose login terminal ends with the CLI signed out settles as a failed attempt, not as the old sign-in', () =>
  Effect.gen(function* () {
    const rows = makeHarnessDirectoryStore({ home: join(home, 'reconnect-failed'), machine: 'machine' });
    yield* rows.keep(provider.id, {
      key: AccountKey.make('standing'),
      label: 'old@cli',
      machine: 'machine',
      directory: join(home, 'standing-cli'),
      addedAt: 1,
      signed: true,
      pending: false,
    });
    const ended = yield* Deferred.make<void>();
    const watched: AccountCli['Service'] = {
      installed: cli.installed,
      changes: Stream.empty,
      run: () => Effect.succeed({ stdout: '', stderr: '', code: 1 }),
      login: cli.login,
      stop: cli.stop,
      ended: () => Deferred.await(ended),
    };
    const refreshed = yield* Queue.unbounded<string | undefined>();
    const book = yield* bookOf(rows, defaults(), watched, quotaInto(refreshed));

    yield* book.begin(provider.id, 1, 'standing');
    expect(yield* book.status(provider.id)).toMatchObject([{ account: 'standing', pending: true, failed: false }]);

    yield* Deferred.succeed(ended, undefined);
    expect(yield* Queue.take(refreshed)).toBe(provider.id);
    expect(yield* book.status(provider.id)).toMatchObject([{ account: 'standing', pending: false, failed: true }]);
    expect(yield* rows.of(provider.id)).toMatchObject([{ key: 'standing', signed: false, failed: true }]);
  }),
);

it.effect('a refused login start leaves no hidden pending account and the next successful login completes alone', () =>
  Effect.gen(function* () {
    const rows = makeHarnessDirectoryStore({ home: join(home, 'refused'), machine: 'machine' });
    const rejected: AccountCli['Service'] = {
      ...cli,
      login: () => Effect.fail(new GateRefusal('account-cli-failed', 'start refused', ['retry'])),
    };
    const book = yield* bookOf(rows, defaults(), rejected);
    expect(yield* Effect.flip(book.begin(provider.id, 1))).toMatchObject({ code: 'account-cli-failed' });
    expect(yield* rows.of(provider.id)).toEqual([]);
    const next = yield* bookOf(rows, defaults(), cli);
    const started = yield* next.begin(provider.id, 1);
    expect(yield* next.complete(provider.id)).toMatchObject({ account: started.account, pending: false });
  }),
);

it.effect('an uncertain login start keeps a visible pending account that can complete without launching another login', () =>
  Effect.gen(function* () {
    const rows = makeHarnessDirectoryStore({ home: join(home, 'uncertain'), machine: 'machine' });
    const uncertain: AccountCli['Service'] = {
      ...cli,
      login: () => Effect.fail(new GateRefusal('account-cli-uncertain', 'receipt unavailable', ['read the terminal operation'])),
    };
    const book = yield* bookOf(rows, defaults(), uncertain);
    expect(yield* Effect.flip(book.begin(provider.id, 1))).toMatchObject({ code: 'account-cli-uncertain' });
    const pending = yield* book.status(provider.id);
    expect(pending).toMatchObject([{ pending: true }]);
    expect(yield* Effect.flip(book.launch(provider.id, pending[0]!.account))).toMatchObject({ code: 'unknown-account' });
    expect(yield* book.complete(provider.id, pending[0]!.account)).toMatchObject({ account: pending[0]!.account, pending: false });
  }),
);

it.effect('directory accounts retain the exact spelling, the unset address and their machine scope across readers', () =>
  Effect.gen(function* () {
    const directory = join(home, 'records');
    const a = makeHarnessDirectoryStore({ home: directory, machine: 'machine-a' });
    const b = makeHarnessDirectoryStore({ home: directory, machine: 'machine-b' });
    const base = { label: 'Account', addedAt: 1, signed: true, pending: false };
    yield* a.keep(provider.id, { ...base, key: AccountKey.make('same'), machine: 'machine-a', directory: '/account/link/' });
    yield* b.keep(provider.id, { ...base, key: AccountKey.make('same'), machine: 'machine-b', directory: null });
    const reread = makeHarnessDirectoryStore({ home: directory, machine: 'machine-a' });
    expect(yield* reread.of(provider.id)).toMatchObject([{ machine: 'machine-a', directory: '/account/link/' }]);
    expect(yield* b.of(provider.id)).toMatchObject([{ machine: 'machine-b', directory: null }]);
    expect(yield* a.of('constructor')).toEqual([]);
    yield* a.keep('constructor', { ...base, key: AccountKey.make('key'), machine: 'machine-a', directory: null });
    expect(yield* a.of('constructor')).toMatchObject([{ key: 'key', directory: null }]);
  }),
);

it.effect('the existing CLI login becomes an unset account at its first launch; an explicit selection wins over the default', () =>
  Effect.gen(function* () {
    const rows = makeHarnessDirectoryStore({ home: join(home, 'existing'), machine: 'machine' });
    const selected = defaults();
    const book = yield* bookOf(rows, selected, cli);
    const launch = yield* book.launch(provider.id);
    expect(launch).toMatchObject({
      account: 'default',
      directory: null,
      entries: [
        { _tag: 'Unset', name: 'KEY' },
        { _tag: 'Unset', name: 'CONFIG_ROOT' },
      ],
    });
    yield* rows.keep(provider.id, {
      key: AccountKey.make('second'),
      label: 'Second',
      machine: 'machine',
      directory: '/another/',
      addedAt: 2,
      signed: true,
      pending: false,
    });
    yield* selected.saveDefaultAccount(provider.id, 'default');
    expect((yield* book.launch(provider.id, 'second'))?.directory).toBe('/another/');
  }),
);

it.effect(
  'the default account follows the CLI login: a launch reads it past a stored sign-out, and later listings carry a switch and a sign-out',
  () =>
    Effect.gen(function* () {
      const rows = makeHarnessDirectoryStore({ home: join(home, 'cli-login'), machine: 'machine' });
      let login: string | null = 'first@cli';
      const port: AccountCli['Service'] = {
        ...cli,
        run: () => Effect.sync(() => ({ stdout: login ?? '', stderr: '', code: login === null ? 1 : 0 })),
      };
      const logins = yield* Effect.provide(
        makeDefaultLoginBook,
        Context.make(HarnessDirectories, rows).pipe(Context.add(AccountCli, port)),
      );
      const book = yield* bookOf(rows, defaults(), port, undefined, logins);
      const listing = harnessStored({ of: () => Effect.succeed([]) }, rows, registry, logins, () => []);
      const base = { key: DEFAULT_LOGIN, label: 'old@cli', machine: 'machine', directory: null, addedAt: 1, pending: false };
      yield* rows.keep(provider.id, { ...base, signed: false });
      expect(yield* book.launch(provider.id)).toMatchObject({ account: DEFAULT_LOGIN, directory: null });
      expect(yield* listing.of(provider.id)).toMatchObject([{ key: DEFAULT_LOGIN, label: 'first@cli', problem: null }]);
      login = 'second@cli';
      yield* TestClock.adjust(LISTED_MS + 1);
      expect(yield* listing.of(provider.id)).toMatchObject([{ key: DEFAULT_LOGIN, label: 'second@cli', problem: null }]);
      login = null;
      yield* TestClock.adjust(LISTED_MS + 1);
      expect(yield* listing.of(provider.id)).toMatchObject([{ key: DEFAULT_LOGIN, problem: { kind: 'signed-out' } }]);
      expect(yield* Effect.flip(book.launch(provider.id))).toMatchObject({ code: 'account-required' });
    }),
);

it.effect(
  'an uninstalled harness keeps its accounts visible as not installed, and a provider holding nothing is refused as not installed',
  () =>
    Effect.gen(function* () {
      const rows = makeHarnessDirectoryStore({ home: join(home, 'uninstalled'), machine: 'machine' });
      const book = yield* bookOf(rows, defaults(), cli);
      const started = yield* book.begin(provider.id, 1);
      yield* book.complete(provider.id, started.account);
      const removed: ProviderRegistry['Service'] = staticRegistry(providerCatalogOf([]));
      const logins = yield* Effect.provide(makeDefaultLoginBook, Context.make(HarnessDirectories, rows).pipe(Context.add(AccountCli, cli)));
      const accounts = harnessStored({ of: () => Effect.succeed([]) }, rows, removed, logins, () => []);

      expect(yield* accounts.of(provider.id)).toMatchObject([{ key: started.account, problem: { kind: 'not-installed' } }]);
      expect(yield* Effect.flip(accounts.of('never-installed'))).toMatchObject({ code: 'provider-not-installed' });
    }),
);

it.effect('parallel login completions name their visible pending account and removal wins over a late completion', () =>
  Effect.gen(function* () {
    const rows = makeHarnessDirectoryStore({ home: join(home, 'pending'), machine: 'machine' });
    const book = yield* bookOf(rows, defaults(), cli);
    const one = yield* book.begin(provider.id, 1);
    const two = yield* book.begin(provider.id, 1);
    expect(yield* Effect.flip(book.complete(provider.id))).toMatchObject({ code: 'account-required' });
    const signed = yield* book.complete(provider.id, one.account);
    expect(signed).toMatchObject({ provider: provider.id, account: one.account, label: 'Signed in' });
    expect(yield* book.status(provider.id)).toMatchObject([
      { account: one.account, pending: false },
      { account: two.account, pending: true },
    ]);
    const entered = yield* Deferred.make<void>();
    const answered = yield* Deferred.make<{ stdout: string; stderr: string; code: number }>();
    const delayed: AccountCli['Service'] = {
      ...cli,
      run: () => Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(answered)),
    };
    const lateBook = yield* bookOf(rows, defaults(), delayed);
    const late = yield* Effect.forkChild(Effect.flip(lateBook.complete(provider.id, two.account)));
    yield* Deferred.await(entered);
    yield* book.remove(provider.id, two.account);
    yield* Deferred.succeed(answered, { stdout: '', stderr: '', code: 0 });
    expect(yield* Fiber.join(late)).toMatchObject({ code: 'unknown-account' });
    expect((yield* rows.of(provider.id)).map((row) => row.key)).toEqual([one.account]);
  }),
);
