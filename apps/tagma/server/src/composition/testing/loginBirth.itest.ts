import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Deferred, Effect, Fiber, FileSystem, Queue, Schema, Stream } from 'effect';
import { join } from 'node:path';
import { ProviderCredentials } from '../../providers/contract/service/credentials.js';
import { HarnessAccounts } from '../../providers/contract/service/harness.js';
import { scriptedModel } from './scriptedModel.js';
import { AccountQuota } from '../../providers/contract/service/quota.js';
import { DefaultAccounts } from '../../providers/contract/service/accounts.js';
import { HarnessDirectories } from '../../providers/accounts/harnessRows.js';
import { PROVIDER_OPERATIONS } from '../../providers/contract/wire/operations.js';
import type { AccountQuotaRow, QuotaTable } from '../../providers/contract/wire/accounts.js';
import { knownAnswer } from '../../platform/contract/wire/operation.js';
import { ThreadHarness } from '../../threads/contract/service/engine.js';
import { makeDoorWorld, type DoorFixture } from './doorFixture.js';
import { doorTenant } from './projectTenant.js';

const rowsFrom = Effect.fnUntraced(function* (quota: AccountQuota['Service']) {
  const frames = yield* Queue.unbounded<QuotaTable>();
  yield* Effect.forkScoped(Stream.runForEach(quota.changes, (frame) => Queue.offer(frames, frame)));
  return Effect.fnUntraced(function* (accept: (row: AccountQuotaRow) => boolean) {
    for (;;) {
      const frame = yield* Queue.take(frames);
      const row = frame.find(accept);
      if (row !== undefined) return row;
    }
  });
});

const finishLogin = Effect.fnUntraced(function* (world: DoorFixture['Service'], projectId: number, account: string) {
  const completed = yield* world.op('complete_sign_in', { provider: 'claude-code', account }, `project=${projectId}`);
  expect(completed.body).toMatchObject(completed.status === 200 ? { status: 'signed' } : { code: 'no-sign-in' });
  const held = yield* Context.get(world.runtime.owners, HarnessAccounts).status('claude-code');
  expect(held.find((row) => row.account === account)).toMatchObject({ pending: false });
});

it.live('the first prompt waits for Claude discovery, keeps its model, and survives local sign-out without switching accounts', () =>
  Effect.gen(function* () {
    const world = yield* makeDoorWorld({ logins: { claude: 'held', codex: 'signed-in' } });
    const served = world;
    const tenant = yield* doorTenant(world);
    const quota = Context.get(world.runtime.owners, AccountQuota);
    const accounts = Context.get(world.runtime.owners, DefaultAccounts);
    const harness = Context.get(world.runtime.owners, ThreadHarness);
    const nextRow = yield* rowsFrom(quota);
    yield* served.logins.started('claude');
    expect(yield* tenant.perform('read_model_connection', {})).toEqual({
      status: 'read',
      state: 'discovering',
      plans: ['claude-code', 'openai-oauth', 'muse-code', 'opencode'],
    });
    const defaultsDone = yield* Deferred.make<void>();
    const birthDone = yield* Deferred.make<void>();
    const reading = yield* Effect.forkScoped(
      tenant.perform('read_model_defaults', {}).pipe(Effect.tap(() => Deferred.succeed(defaultsDone, undefined))),
    );
    const birth = yield* Effect.forkScoped(tenant.thread({ type: 'tagma' }).pipe(Effect.tap(() => Deferred.succeed(birthDone, undefined))));
    yield* Effect.yieldNow;
    expect(yield* Deferred.isDone(defaultsDone)).toBe(false);
    expect(yield* Deferred.isDone(birthDone)).toBe(false);
    expect((yield* served.logins.starts('claude')).map((start) => start.argv)).toEqual([['auth', 'status', '--json']]);
    yield* served.logins.answer('claude', 'signed-in');
    const initial = yield* Fiber.join(reading);
    expect(initial).toMatchObject({ status: 'read', provider: 'claude-code' });
    const thread = yield* Fiber.join(birth);
    expect(thread).toMatchObject({ provider: 'claude-code' });
    const primary = yield* nextRow((row) => row.provider === 'claude-code' && row.problem === null && row.default);
    const adopted = yield* world.op('begin_sign_in', { provider: 'claude-code' });
    expect(adopted.status).toBe(200);
    expect(adopted.body).toMatchObject({ status: 'begun', flow: { flow: 'adopted', account: primary.account } });
    const beforeFirstOut = yield* Effect.forkScoped(
      nextRow((row) => row.provider === 'claude-code' && row.account === primary.account && row.problem?.kind === 'signed-out'),
    );
    yield* served.logins.answer('claude', 'signed-out');
    yield* Fiber.join(beforeFirstOut);
    expect(yield* tenant.perform('read_model_defaults', {})).toEqual(initial);
    expect((yield* world.op('create_thread', { type: 'tagma' }, `project=${tenant.projectId}`)).body).toMatchObject({
      code: 'account-signed-out',
    });
    const beforeFirstIn = yield* Effect.forkScoped(
      nextRow((row) => row.provider === 'claude-code' && row.account === primary.account && row.problem === null),
    );
    yield* served.logins.answer('claude', 'signed-in');
    yield* Fiber.join(beforeFirstIn);
    expect(yield* tenant.perform('read_model_defaults', {})).toEqual(initial);
    yield* tenant.turn(thread.id, { text: 'First prompt', key: 'first-login-send' });
    const saved = yield* tenant.perform('read_model_defaults', {});
    expect(saved).toMatchObject({ status: 'read', provider: 'claude-code', account: primary.account });
    const before = yield* accounts.defaultAccount('claude-code');
    const add = yield* Schema.decodeUnknownEffect(knownAnswer(PROVIDER_OPERATIONS.begin_sign_in.answer))(
      yield* tenant.perform('begin_sign_in', { provider: 'claude-code', projectId: tenant.projectId }),
    );
    const added = add.flow;
    if (added.flow !== 'external-cli') return yield* Effect.die('Add account did not open its CLI login');
    const secondary = yield* nextRow((row) => row.provider === 'claude-code' && row.account === added.account && row.problem === null);
    expect(secondary.origin).toMatchObject({ kind: 'cli' });
    expect(secondary.origin).not.toEqual(primary.origin);
    yield* finishLogin(world, tenant.projectId, added.account);
    const pendingOut = yield* Effect.forkScoped(
      nextRow((row) => row.provider === 'claude-code' && row.account === primary.account && row.problem?.kind === 'signed-out'),
    );
    yield* served.logins.answer('claude', 'signed-out');
    yield* Fiber.join(pendingOut);
    expect(yield* accounts.defaultAccount('claude-code')).toEqual(before);
    expect(yield* tenant.perform('read_model_defaults', {})).toEqual(saved);
    expect((yield* harness.reads.snapshot(thread.id)).thread).toMatchObject({
      provider: thread.provider,
      model: thread.model,
      account: thread.account,
    });
    const refused = yield* world.op('create_thread', { type: 'tagma' }, `project=${tenant.projectId}`);
    expect(refused.body).toMatchObject({ code: 'account-signed-out' });
    const pendingIn = yield* Effect.forkScoped(
      nextRow((row) => row.provider === 'claude-code' && row.account === primary.account && row.problem === null),
    );
    yield* served.logins.answer('claude', 'signed-in');
    yield* Fiber.join(pendingIn);
    yield* tenant.turn(thread.id, { text: 'After signing in again', key: 'restored-login-send' });
    expect(yield* accounts.defaultAccount('claude-code')).toEqual(before);
    expect(yield* tenant.perform('read_model_defaults', {})).toEqual(saved);
    const directories = Context.get(world.runtime.owners, HarnessDirectories);
    expect((yield* directories.of('claude-code')).filter((row) => row.signed)).toHaveLength(2);
  }),
);

it.live('a file-held Codex login serves the first native prompt while a keyring-only login remains available to the CLI', () =>
  Effect.gen(function* () {
    const world = yield* makeDoorWorld({ logins: { codex: 'keyring' }, models: scriptedModel() });
    const tenant = yield* doorTenant(world);
    expect(yield* tenant.perform('read_model_defaults', {})).toMatchObject({ status: 'unconnected' });
    const next = yield* rowsFrom(Context.get(world.runtime.owners, AccountQuota));
    const account = yield* next(
      (row) =>
        row.provider === 'codex' &&
        row.problem === null &&
        row.default &&
        row.lent.some((borrower) => borrower.provider === 'openai-oauth' && borrower.problem?.kind === 'unreadable'),
    );
    expect(account.lent).toContainEqual({ provider: 'openai-oauth', problem: { kind: 'unreadable', reason: expect.any(String) } });
    const cli = Context.get(world.runtime.owners, HarnessAccounts);
    expect(yield* cli.launch('codex')).toMatchObject({ account: account.account, directory: null });
    const terminal = yield* tenant.thread({ type: 'harness:codex', account: account.account });
    const launched = yield* Effect.forkScoped(world.logins.launched('codex'));
    expect(
      yield* tenant.perform('start_turn', { threadId: terminal.id, text: 'A Codex CLI prompt', key: 'keyring-codex-send' }),
    ).toMatchObject({ runId: expect.any(String) });
    yield* Fiber.join(launched);
    expect(yield* tenant.perform('read_model_defaults', {})).toMatchObject({ status: 'unconnected' });
    const credentials = Context.get(world.runtime.owners, ProviderCredentials);
    expect((yield* credentials.tokens.held('openai-oauth'))[0]).toMatchObject({ credential: null, unreadable: expect.any(String) });
    const readable = yield* Effect.forkScoped(
      next(
        (row) =>
          row.provider === 'codex' &&
          row.account === account.account &&
          row.lent.some((borrower) => borrower.provider === 'openai-oauth' && borrower.problem === null),
      ),
    );
    yield* world.logins.answer('codex', 'signed-in');
    yield* Fiber.join(readable);
    expect(yield* tenant.perform('read_model_defaults', {})).toMatchObject({ status: 'read', provider: 'openai-oauth' });
    expect(yield* credentials.tokens.getAccessToken('openai-oauth', account.account)).toMatch(/^header\./u);
    const thread = yield* tenant.thread({ type: 'tagma' });
    expect(thread.provider).toBe('openai-oauth');
    yield* tenant.turn(thread.id, { text: 'First ChatGPT prompt', key: 'first-codex-send' });
    expect(yield* tenant.perform('read_model_defaults', {})).toMatchObject({
      status: 'read',
      provider: 'openai-oauth',
      account: account.account,
    });
    const signedOut = yield* Effect.forkScoped(
      next((row) => row.provider === 'codex' && row.account === account.account && row.problem?.kind === 'signed-out'),
    );
    yield* world.logins.answer('codex', 'signed-out');
    yield* Fiber.join(signedOut);
    expect(
      (yield* world.op('create_thread', { type: 'tagma', account: account.account }, `project=${tenant.projectId}`)).body,
    ).toMatchObject({ code: 'account-signed-out' });
  }),
);

it.live('sign-in uses the default place, reconnect keeps its address, and an unsupported login stays untouched', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const world = yield* makeDoorWorld({ logins: { claude: 'signed-out' } });
        const tenant = yield* doorTenant(world);
        expect(yield* tenant.perform('read_model_defaults', {})).toMatchObject({ status: 'unconnected' });
        const next = yield* rowsFrom(Context.get(world.runtime.owners, AccountQuota));
        const begun = yield* Schema.decodeUnknownEffect(knownAnswer(PROVIDER_OPERATIONS.begin_sign_in.answer))(
          yield* tenant.perform('begin_sign_in', { provider: 'claude-code', projectId: tenant.projectId }),
        );
        const flow = begun.flow;
        if (flow.flow !== 'external-cli') return yield* Effect.die('The signed-out default did not open its CLI login');
        const primary = yield* next((row) => row.provider === 'claude-code' && row.account === flow.account && row.problem === null);
        expect(primary.origin).toEqual({ kind: 'cli', place: 'default' });
        const login = (yield* world.logins.starts('claude')).find((start) => start.argv[0] === 'auth' && start.argv[1] === 'login');
        expect(login?.variable).toBeNull();
        yield* finishLogin(world, tenant.projectId, primary.account);
        const before = yield* Context.get(world.runtime.owners, DefaultAccounts).defaultAccount('claude-code');
        const reconnect = yield* Schema.decodeUnknownEffect(knownAnswer(PROVIDER_OPERATIONS.begin_sign_in.answer))(
          yield* tenant.perform('begin_sign_in', { provider: 'claude-code', projectId: tenant.projectId, account: primary.account }),
        );
        expect(reconnect.flow).toMatchObject({ flow: 'external-cli', account: primary.account });
        yield* finishLogin(world, tenant.projectId, primary.account);
        expect(yield* Context.get(world.runtime.owners, DefaultAccounts).defaultAccount('claude-code')).toEqual(before);
        expect(
          (yield* Context.get(world.runtime.owners, HarnessDirectories).of('claude-code')).find((row) => row.key === primary.account)
            ?.directory,
        ).toBeNull();
      }),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const world = yield* makeDoorWorld({ logins: { claude: 'unsupported' } });
        const tenant = yield* doorTenant(world);
        expect(yield* tenant.perform('read_model_defaults', {})).toMatchObject({ status: 'unconnected' });
        const files = yield* FileSystem.FileSystem;
        const original = join(world.logins.place('claude'), '.claude.json');
        const before = yield* files.readFileString(original);
        const next = yield* rowsFrom(Context.get(world.runtime.owners, AccountQuota));
        const started = yield* Schema.decodeUnknownEffect(knownAnswer(PROVIDER_OPERATIONS.begin_sign_in.answer))(
          yield* tenant.perform('begin_sign_in', { provider: 'claude-code', projectId: tenant.projectId }),
        );
        const flow = started.flow;
        if (flow.flow !== 'external-cli') return yield* Effect.die('An unsupported login did not open an isolated CLI login');
        const signed = yield* next((row) => row.provider === 'claude-code' && row.account === flow.account && row.problem === null);
        expect(signed.origin).not.toEqual({ kind: 'cli', place: 'default' });
        expect(yield* files.readFileString(original)).toBe(before);
      }),
    );
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
