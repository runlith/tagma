import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem } from 'effect';
import { claudeCodeDescription } from '@runlith/adapter-anthropic/models/anthropic';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { HarnessDirectories } from '../../providers/accounts/harnessRows.js';
import { DefaultAccounts } from '../../providers/contract/service/accounts.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { InstalledHarnesses } from '../../threads/contract/service/harness.js';
import type { DoorFixture } from './doorFixture.js';
import { subscriptionDescription } from '@runlith/builtin-catalog/subscription/description';
import { ModelPreferences } from '../../native-harness/contract/service/models.js';
import type { ModelDefaultsWrite } from '../../native-harness/contract/wire/modelSelection.js';
import { and, eq, inArray } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { defaultAccount } from '../../providers/store/tables.js';

export const keepAccountDefaults = Effect.fnUntraced(function* (world: DoorFixture['Service'], ...providers: readonly string[]) {
  const { db } = Context.get(world.runtime.graph, MachineStore);
  const units = Context.get(world.runtime.graph, MachineUnits);
  const catalog = Context.get(world.runtime.owners, ProviderRegistry).current();
  const sources = [...new Set(providers.flatMap((provider) => [provider, catalog.accountSource(provider)]))];
  const where = and(eq(defaultAccount.principalId, OPERATOR_PRINCIPAL), inArray(defaultAccount.provider, sources));
  const previous = yield* units.read((unit) => unit.run(db.select().from(defaultAccount).where(where)));
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const { db } = Context.get(world.runtime.graph, MachineStore);
      const units = Context.get(world.runtime.graph, MachineUnits);
      yield* units.write(writes('test.restoreDefaults', [defaultAccount]), (unit) =>
        Effect.gen(function* () {
          yield* unit.run(db.delete(defaultAccount).where(where));
          if (previous.length > 0) yield* unit.run(db.insert(defaultAccount).values(previous));
        }),
      );
    }).pipe(Effect.orDie),
  );
});

export const claudeLogin = Effect.fn('claudeLogin')(function* (
  world: DoorFixture['Service'],
  options: { readonly restore?: boolean } = {},
) {
  const files = yield* FileSystem.FileSystem;
  const directory = yield* world.directory('claude-login');
  yield* files.writeFileString(
    join(directory, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: 'fixture-bearer',
        refreshToken: 'fixture-refresh',
        expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
        scopes: ['user:inference'],
      },
    }),
  );
  yield* files.writeFileString(
    join(directory, '.claude.json'),
    JSON.stringify({
      oauthAccount: { accountUuid: 'fixture-account', organizationUuid: 'fixture-org', emailAddress: 'fixture@example.com' },
    }),
  );
  const owners = world.runtime.owners;
  const rows = Context.get(owners, HarnessDirectories);
  const account = AccountKey.make('fixture-account');
  const provider = claudeCodeDescription.id;
  const kept = (yield* rows.of(provider)).find((row) => row.key === account);
  const claude = (registry: ProviderRegistry['Service']) => registry.current().sections.find((section) => section.id === 'claude');
  const mode = claude(Context.get(owners, ProviderRegistry))?.selected;
  if (options.restore !== false) {
    yield* keepAccountDefaults(world, provider);
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const standing = world.runtime.owners;
        const directories = Context.get(standing, HarnessDirectories);
        const registry = Context.get(standing, ProviderRegistry);
        const section = claude(registry);
        if (mode !== undefined && section?.selected !== mode && section?.options.some((option) => option.id === mode))
          yield* registry.selectMode('claude', mode);
        yield* kept === undefined ? directories.remove(provider, account) : directories.keep(provider, kept);
      }).pipe(Effect.orDie),
    );
  }
  yield* rows.keep(provider, {
    key: account,
    label: 'fixture@example.com',
    machine: rows.machine,
    directory,
    addedAt: yield* Clock.currentTimeMillis,
    signed: true,
    pending: false,
  });
  yield* Context.get(owners, InstalledHarnesses).settled;
  yield* Context.get(owners, ProviderRegistry).selectMode('claude', 'claude');
  yield* Context.get(owners, DefaultAccounts).saveDefaultAccount(provider, account);
  return account;
});

export const subscriptionLogin = Effect.fnUntraced(function* (world: DoorFixture['Service']) {
  yield* keepAccountDefaults(world, 'subscription');
  return yield* Effect.acquireRelease(
    world.runtime.tokens.add('subscription', {
      accessToken: 'fixture-bearer',
      refreshToken: 'fixture-refresh',
      expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
      scope: 'user:inference',
      account: { uuid: crypto.randomUUID(), email: 'fixture@example.com' },
      organization: { uuid: 'fixture-org', name: 'Fixture' },
    }),
    (key) => world.runtime.signIns.remove('subscription', key).pipe(Effect.orDie),
  );
});

type DefaultsOptions = { readonly restore?: boolean };

export const modelDefaults = Effect.fnUntraced(function* (
  world: DoorFixture['Service'],
  selection: ModelDefaultsWrite,
  options: DefaultsOptions = {},
) {
  const preferences = Context.get(world.runtime.owners, ModelPreferences);
  if (options.restore !== false) {
    yield* keepAccountDefaults(world, selection.provider);
    yield* Effect.acquireRelease(
      preferences
        .modelDefaults()
        .pipe(
          Effect.flatMap((previous) =>
            previous.status === 'read'
              ? Effect.succeed(previous.defaults)
              : Effect.die('the door fixture must have a connected default model'),
          ),
        ),
      (previous) => Context.get(world.runtime.owners, ModelPreferences).setModelDefaults(previous).pipe(Effect.orDie),
    );
  }
  return yield* preferences.setModelDefaults(selection);
});

export const nativeLeads = (world: DoorFixture['Service'], account: string, options: DefaultsOptions = {}) =>
  modelDefaults(
    world,
    {
      provider: subscriptionDescription.id,
      model: subscriptionDescription.defaultTextModel,
      reasoning: null,
      account,
    },
    options,
  );

export const hostedDefaults = (world: DoorFixture['Service']) =>
  modelDefaults(world, {
    provider: claudeCodeDescription.id,
    model: claudeCodeDescription.defaultTextModel,
    reasoning: null,
    account: null,
  });
