import { afterAll, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer, Result, Stream } from 'effect';
import { CLAUDE_CODE_PROVIDER } from '@runlith/adapter-anthropic/models/anthropic';
import { CODEX_PROVIDER, OPENAI_OAUTH_PROVIDER } from '@runlith/adapter-openai/models/openai';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { AccountCli } from '../../providers/contract/service/cli.js';
import { CredentialFiles } from '../../providers/contract/service/credentials.js';
import { type AdapterSource, BuiltinAdapters, ProviderRegistry } from '../../providers/contract/service/registry.js';
import { ProviderAccounts } from '../../providers/contract/service/accounts.js';
import { registryLayer } from '../../providers/registry.js';
import { makeHarnessDirectoryStore } from '../../providers/accounts/harnessRows.js';
import { makeDefaultLoginBook } from '../../providers/accounts/defaultLogins.js';
import { harnessStored } from '../../providers/accounts/harnessStored.js';
import { subscriptionAccounts } from '../../providers/accounts/stored.js';
import { makeBorrowingTokens } from '../../providers/credentials/borrowed.js';
import { createProviderTokens } from '../../providers/credentials/tokens.js';
import { HarnessRegistry } from '../../threads/contract/service/harness.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import type { HarnessId } from '../../platform/contract/wire/session.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { makeModelPreferenceRows } from './preferences.js';
import { makeBirthModels } from './preference.js';

const home = await mkdtemp(join(tmpdir(), 'default-model-'));
afterAll(() => rm(home, { recursive: true, force: true }));

const SOURCES: readonly AdapterSource[] = [
  { id: 'anthropic', origin: 'builtin', version: null, load: () => import('@runlith/adapter-anthropic/adapter') },
  { id: 'openai', origin: 'builtin', version: null, load: () => import('@runlith/adapter-openai/adapter') },
];

const cli = (claudeSignedIn: boolean): AccountCli['Service'] => ({
  installed: () => Effect.succeed({ _tag: 'Found' }),
  changes: Stream.empty,
  run: (command) =>
    Effect.succeed({
      stdout:
        command.program === 'claude'
          ? JSON.stringify(claudeSignedIn ? { loggedIn: true, authMethod: 'claude.ai', email: 'me@example.com' } : { loggedIn: false })
          : '',
      stderr: '',
      code: 0,
    }),
  login: () => Effect.die('choosing a default model starts no login terminal'),
  ended: () => Effect.never,
  stop: () => Effect.die('choosing a default model cancels no login terminal'),
});

const hosting = HarnessRegistry.of({
  register: () => Effect.die('choosing a default model registers no harness'),
  resolve: () => Effect.die('choosing a default model resolves no harness'),
  list: () => [],
  writes: (base) => base,
  seating: (to, models) =>
    to.provider === CLAUDE_CODE_PROVIDER
      ? Effect.succeed({ name: 'claude-code' as HarnessId, seat: () => Effect.die('choosing a default model seats nothing') })
      : models.registered(to.provider) && models.named(to.provider).auth === 'cli'
        ? Effect.fail(new GateRefusal('model-unavailable', `${to.provider} models run in their own CLI`, ['start its CLI']))
        : Effect.succeed(null),
});

const birthOn = Effect.fnUntraced(function* (
  signed: { readonly claude: boolean; readonly codex: boolean },
  saved?: { readonly provider: string; readonly model: string; readonly reasoning: string | null },
) {
  const path = yield* Effect.promise(() => mkdtemp(join(home, 'case-')));
  const tokensPath = join(path, 'tokens.json');
  const account = cli(signed.claude);
  const registry = Context.get(
    yield* Layer.build(
      registryLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(BuiltinAdapters, { sources: SOURCES }),
            Layer.succeed(CredentialFiles, { tokensPath }),
            Layer.succeed(AccountCli, account),
          ),
        ),
      ),
    ),
    ProviderRegistry,
  );
  const directories = makeHarnessDirectoryStore({ home: path, machine: 'machine' });
  if (signed.claude)
    yield* directories.keep(CLAUDE_CODE_PROVIDER, {
      key: AccountKey.make('default'),
      label: 'me@example.com',
      machine: 'machine',
      directory: null,
      addedAt: 1,
      signed: true,
      pending: false,
      requested: true,
    });
  if (signed.codex)
    yield* directories.keep(CODEX_PROVIDER, {
      key: AccountKey.make('codex-login'),
      label: 'codex@example.com',
      machine: 'machine',
      directory: path,
      addedAt: 1,
      signed: true,
      pending: false,
    });
  const tokens = makeBorrowingTokens({
    own: createProviderTokens(tokensPath, () => registry.current().wires, vendorWire),
    catalog: registry.current,
    directories,
    cli: account,
  });
  const accounts = harnessStored(
    subscriptionAccounts(tokens),
    directories,
    registry,
    makeDefaultLoginBook({ rows: directories, cli: account }),
    () => [],
  );
  const stores = yield* Layer.build(
    unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations)))),
  );
  const rows = yield* Effect.provide(makeModelPreferenceRows, stores);
  if (saved !== undefined) yield* rows.saveModelSelection(OPERATOR_PRINCIPAL, saved);
  const births = yield* Effect.provide(
    makeBirthModels({ rows }),
    Context.make(ProviderRegistry, registry).pipe(
      Context.add(
        ProviderAccounts,
        ProviderAccounts.of({ ...accounts, connected: Effect.die('choosing a default model reads no connected set') }),
      ),
      Context.add(HarnessRegistry, hosting),
    ),
  );
  return yield* Effect.result(births.selection({}));
});

it.effect('a birth without a named model starts on the first selected signed-in subscription, Claude Code before ChatGPT', () =>
  Effect.gen(function* () {
    const claude = { _tag: 'Success', success: { provider: CLAUDE_CODE_PROVIDER, model: 'claude-opus-5-5' } };
    expect(yield* birthOn({ claude: true, codex: false })).toMatchObject(claude);
    expect(yield* birthOn({ claude: false, codex: true })).toMatchObject({
      _tag: 'Success',
      success: { provider: OPENAI_OAUTH_PROVIDER, model: 'gpt-6.1-sol' },
    });
    expect(yield* birthOn({ claude: true, codex: true })).toMatchObject(claude);
    const none = yield* birthOn({ claude: false, codex: false });
    expect(Result.isFailure(none) && none.failure instanceof GateRefusal && none.failure.code).toBe('no-model-connected');
  }),
);

it.effect('a birth on the operator default that names no rung starts on the model default rung, and a named rung stands', () =>
  Effect.gen(function* () {
    const signed = { claude: true, codex: true };
    const on = (provider: string, model: string, reasoning: string | null) =>
      Effect.map(birthOn(signed, { provider, model, reasoning }), (born) => (Result.isSuccess(born) ? born.success.reasoning : born));
    expect(yield* on(CLAUDE_CODE_PROVIDER, 'claude-opus-5-5', null)).toBe('medium');
    expect(yield* on(OPENAI_OAUTH_PROVIDER, 'gpt-6.1-sol', null)).toBe('high');
    expect(yield* on(CLAUDE_CODE_PROVIDER, 'claude-opus-5-5', 'low')).toBe('low');
  }),
);
