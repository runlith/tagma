import { afterAll, expect } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { adapter as anthropic } from '@runlith/adapter-anthropic/adapter';
import { adapter as subscription } from '@runlith/builtin-catalog/subscription/adapter';
import { adapter as openai } from '@runlith/adapter-openai/adapter';
import { VENDOR_CALL_TIMEOUT_MS } from '@runlith/llm/vendorCall';
import { AccountKey } from '@runlith/llm/models/authStatus';
import type { StoredCredential } from '@runlith/llm/oauth/credential';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { Provider, WireProvider } from '@runlith/tagma/adapter/provider';
import { Deferred, Effect, Fiber, Schema, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { CliLoginUnreadable } from '@runlith/llm/oauth/cliStore';
import { makeHarnessDirectoryStore } from '../accounts/harnessRows.js';
import { makeDefaultLoginBook } from '../accounts/defaultLogins.js';
import type { AccountCli, AccountCommand } from '../contract/service/cli.js';
import { providerCatalogOf } from '../testing/registry.js';
import { testTokens } from '../testing/tokens.js';
import { makeBorrowingTokens } from './borrowed.js';

const home = await mkdtemp(join(tmpdir(), 'borrowed-'));
afterAll(() => rm(home, { recursive: true, force: true }));
const host = { product: { mcpServer: 'tagma', client: { name: 'tagma', version: 'test' } }, instances: [] };
const NOW = 1_000_000_000;
const HOUR = 3_600_000;

const world = Effect.fnUntraced(function* (
  name: string,
  lent: Map<string | null, StoredCredential | CliLoginUnreadable>,
  renewed: (directory: string | null) => void,
  runCommand?: AccountCli['Service']['run'],
) {
  const borrowing = subscription(host).find((provider) => provider.id === 'subscription') as WireProvider;
  const providers: readonly Provider[] = [
    ...anthropic(host),
    {
      ...borrowing,
      borrows: {
        ...borrowing.borrows!,
        read: (directory) => {
          const held = lent.get(directory);
          return held instanceof CliLoginUnreadable ? Effect.fail(held) : Effect.succeed(held ?? null);
        },
      },
    },
  ];
  const directories = makeHarnessDirectoryStore({ home: join(home, name), machine: 'machine' });
  const directory = join(home, name, 'claude', 'one');
  yield* directories.keep('claude-code', {
    key: AccountKey.make('one'),
    label: 'one@example.com',
    machine: 'machine',
    directory,
    addedAt: NOW,
    signed: true,
    pending: false,
  });
  const runs: AccountCommand[] = [];
  const cli: AccountCli['Service'] = {
    installed: () => Effect.succeed({ _tag: 'Found' } as const),
    changes: Stream.empty,
    run:
      runCommand ??
      ((command) =>
        Effect.sync(() => runs.push(command)).pipe(
          Effect.andThen(Effect.sleep('20 millis')),
          Effect.andThen(
            Effect.sync(() => {
              renewed(command.cwd ?? null);
              return { stdout: '', stderr: '', code: 0 };
            }),
          ),
        )),
    login: () => Effect.succeed(Schema.decodeUnknownSync(ExecutionRef)({ installation: 'fixture', execution: '1', incarnation: 1 })),
    ended: () => Effect.never,
    stop: () => Effect.die('borrowing credentials cancels no login terminal'),
  };
  const catalog = providerCatalogOf(providers);
  const own = testTokens(join(home, name, 'tokens.json'));
  const tokens = makeBorrowingTokens({ own, catalog: () => catalog, directories, cli, now: () => NOW });
  const modelTokens = makeBorrowingTokens({
    own,
    catalog: () => catalog,
    directories,
    cli,
    now: () => NOW,
    options: { renew: true, logins: makeDefaultLoginBook({ rows: directories, cli }) },
  });
  return { tokens, modelTokens, runs, directory, directories, catalog };
});

const credential = (accessToken: string, expiresAt: number) =>
  ({
    accessToken,
    refreshToken: `refresh-${accessToken}`,
    expiresAt,
    scope: 'user:inference',
    account: { uuid: 'uuid', email: 'one@example.com' },
    organization: { uuid: 'org', name: '' },
  }) as StoredCredential;

const ONE = AccountKey.make('one');

const signedDirectory = (key: string, directory: string | null) => ({
  requested: true as const,
  key: AccountKey.make(key),
  label: 'one@example.com',
  machine: 'machine',
  directory,
  addedAt: NOW,
  signed: true,
  pending: false,
});

it.live('one vendor identity has one row across directories in the selected CLI mode', () =>
  Effect.gen(function* () {
    const lent = new Map<string | null, StoredCredential>();
    const { tokens, directory, directories } = yield* world('identity', lent, () => undefined);
    const borrowed = credential('borrowed', NOW + HOUR);
    lent.set(directory, borrowed);
    yield* directories.keep('claude-code', signedDirectory('default', null));
    lent.set(null, borrowed);
    expect((yield* tokens.held('subscription')).map((row) => row.key)).toEqual([ONE]);
    expect(yield* tokens.find('subscription', { ...borrowed, accessToken: 'another-grant' })).toMatchObject({ key: ONE });

    lent.set(null, { ...borrowed, account: { uuid: 'different', email: 'one@example.com' } } as StoredCredential);
    expect((yield* tokens.held('subscription')).map((row) => row.key)).toEqual([ONE, AccountKey.make('default')]);
  }),
);

it.live('identity lookup finds a readable match past an unreadable directory and refuses unproved absence', () =>
  Effect.gen(function* () {
    const lent = new Map<string | null, StoredCredential | CliLoginUnreadable>();
    const { tokens, directory, directories } = yield* world('unreadable-identity', lent, () => undefined);
    lent.set(directory, new CliLoginUnreadable({ provider: 'subscription', source: directory, detail: 'malformed' }));
    const held = credential('readable', NOW + HOUR);
    lent.set(null, held);
    yield* directories.keep('claude-code', signedDirectory('default', null));
    expect(yield* tokens.find('subscription', held)).toMatchObject({ key: 'default', credential: held });
    const missing = { ...held, account: { uuid: 'absent', email: 'absent@example.com' } } as StoredCredential;
    expect(yield* Effect.flip(tokens.find('subscription', missing))).toMatchObject({ kind: 'read', account: ONE });
  }),
);

it.live('a borrowed account signs with the token its lender holds, and renewal runs the lender once for concurrent callers', () =>
  Effect.gen(function* () {
    const lent = new Map<string | null, StoredCredential>();
    const { modelTokens: tokens, runs, directory } = yield* world('renew', lent, (cwd) => lent.set(cwd, credential('fresh', NOW + HOUR)));
    lent.set(directory, credential('held', NOW + HOUR));

    expect((yield* tokens.held('subscription')).map((row) => [row.key, row.credential?.accessToken])).toEqual([[ONE, 'held']]);
    expect(yield* tokens.getAccessToken('subscription', ONE)).toBe('held');
    expect(runs).toHaveLength(0);

    lent.set(directory, credential('stale', NOW + 60_000));
    const answers = yield* Effect.all(
      [1, 2, 3].map(() => tokens.getAccessToken('subscription', ONE)),
      { concurrency: 'unbounded' },
    );
    expect(answers).toEqual(['fresh', 'fresh', 'fresh']);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.entries).toContainEqual({ _tag: 'Set', name: 'CLAUDE_CONFIG_DIR', value: directory });
  }),
);

it.live('borrowed reading keeps a still-valid token and reports expiry without renewing until a model asks', () =>
  Effect.gen(function* () {
    const lent = new Map<string | null, StoredCredential>();
    const { tokens, modelTokens, directory } = yield* world('reading', lent, (cwd) => lent.set(cwd, credential('fresh', NOW + HOUR)));
    lent.set(directory, credential('soon', NOW + 60_000));
    expect(yield* tokens.getAccessToken('subscription', ONE)).toBe('soon');
    lent.set(directory, credential('expired', NOW));
    expect(yield* tokens.get('subscription', ONE)).toMatchObject({ credential: { accessToken: 'expired' } });
    expect(yield* Effect.flip(tokens.getAccessToken('subscription', ONE))).toMatchObject({ kind: 'reconnect' });
    expect(lent.get(directory)?.accessToken).toBe('expired');
    expect(yield* modelTokens.getAccessToken('subscription', ONE)).toBe('fresh');
    expect(yield* tokens.getAccessToken('subscription', ONE)).toBe('fresh');
  }),
);

it.live('a rejected borrowed token is reread, and a lender still holding it asks to sign in again', () =>
  Effect.gen(function* () {
    const lent = new Map<string | null, StoredCredential>();
    const { tokens, runs, directory } = yield* world('recover', lent, () => undefined);
    lent.set(directory, credential('rotated', NOW + HOUR));
    expect(yield* tokens.recoverAccessToken('subscription', ONE, 'rejected')).toBe('rotated');

    const refused = yield* Effect.flip(tokens.recoverAccessToken('subscription', ONE, 'rotated'));
    expect(refused).toMatchObject({ _tag: 'TokenStoreFailed', kind: 'reconnect' });
    lent.set(directory, credential('rotated', NOW));
    expect(yield* Effect.flip(tokens.recoverAccessToken('subscription', ONE, 'rotated'))).toMatchObject({ kind: 'reconnect' });
    expect(runs).toHaveLength(0);
  }),
);

it.effect('renewal waits at most one provider request and releases the failed renewal for the next caller', () =>
  Effect.gen(function* () {
    const lent = new Map<string | null, StoredCredential>();
    const started = Deferred.makeUnsafe<void>();
    let stalled = true;
    const { modelTokens: tokens, directory } = yield* world(
      'deadline',
      lent,
      () => undefined,
      (command) =>
        Effect.gen(function* () {
          if (stalled) {
            yield* Deferred.succeed(started, undefined);
            return yield* Effect.never;
          }
          lent.set(command.cwd ?? null, credential('fresh', NOW + HOUR));
          return { stdout: '', stderr: '', code: 0 };
        }),
    );
    lent.set(directory, credential('expired', NOW));
    const pending = yield* Effect.forkChild(Effect.flip(tokens.getAccessToken('subscription', ONE)));
    yield* Deferred.await(started);
    yield* TestClock.adjust(VENDOR_CALL_TIMEOUT_MS);
    expect(yield* Fiber.join(pending)).toMatchObject({ kind: 'refresh', account: ONE });
    stalled = false;
    expect(yield* tokens.getAccessToken('subscription', ONE)).toBe('fresh');
  }),
);

it.live('Codex directory accounts are read from their auth.json and only Codex renews a rejected login', () =>
  Effect.gen(function* () {
    const directory = join(home, 'codex');
    yield* Effect.promise(() => mkdir(directory));
    const jwt = (claims: unknown) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
    const document = (token: string) => ({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: jwt({ exp: (NOW + HOUR) / 1000, token }),
        refresh_token: `refresh-${token}`,
        id_token: jwt({ email: 'codex@example.com' }),
        account_id: 'codex-account',
      },
    });
    const writeAuth = (token: string) => Effect.promise(() => writeFile(join(directory, 'auth.json'), JSON.stringify(document(token))));
    yield* writeAuth('old');
    const providers = openai(host);
    const directories = makeHarnessDirectoryStore({ home: join(home, 'codex-rows'), machine: 'machine' });
    yield* directories.keep('codex', {
      key: ONE,
      label: 'Codex',
      machine: 'machine',
      directory,
      addedAt: NOW,
      signed: true,
      pending: false,
    });
    const own = testTokens(join(home, 'codex-own.json'));
    let renews = true;
    const cli: AccountCli['Service'] = {
      installed: () => Effect.succeed({ _tag: 'Found' } as const),
      changes: Stream.empty,
      run: () => Effect.andThen(renews ? writeAuth('fresh') : Effect.void, Effect.succeed({ stdout: '', stderr: '', code: 0 })),
      login: () => Effect.never,
      ended: () => Effect.never,
      stop: () => Effect.die('borrowing credentials cancels no login terminal'),
    };
    const catalog = () => providerCatalogOf(providers);
    const tokens = makeBorrowingTokens({
      own,
      catalog,
      directories,
      cli,
      now: () => NOW,
      options: { renew: true, logins: makeDefaultLoginBook({ rows: directories, cli }) },
    });
    const old = document('old').tokens.access_token;
    const fresh = document('fresh').tokens.access_token;
    const reading = makeBorrowingTokens({ own, catalog, directories, cli, now: () => NOW });
    expect(yield* Effect.flip(reading.recoverAccessToken('openai-oauth', ONE, old))).toMatchObject({ kind: 'reconnect' });
    expect(yield* reading.getAccessToken('openai-oauth', ONE)).toBe(old);
    expect(yield* tokens.getAccessToken('openai-oauth', ONE)).toBe(old);
    expect((yield* tokens.held('openai-oauth')).map((row) => row.key)).toEqual([ONE]);
    expect(yield* tokens.recoverAccessToken('openai-oauth', ONE, old)).toBe(fresh);
    renews = false;
    expect(yield* Effect.flip(tokens.recoverAccessToken('openai-oauth', ONE, fresh))).toMatchObject({ kind: 'reconnect' });
    expect(yield* own.accounts('openai-oauth')).toEqual([]);
  }),
);

it.live('a borrowed account is managed by its lender, never removed through the borrower', () =>
  Effect.gen(function* () {
    const { tokens } = yield* world('remove', new Map(), () => undefined);
    expect(yield* Effect.flip(tokens.remove('subscription', ONE))).toMatchObject({ kind: 'origin' });
  }),
);
