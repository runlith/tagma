import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Effect, Layer } from 'effect';
import { SUBSCRIPTION_PROVIDER } from '@runlith/builtin-catalog/subscription/description';
import type { SubscriptionCredential } from '@runlith/builtin-catalog/subscription/provider';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { OPENAI_OAUTH_PROVIDER } from '@runlith/adapter-openai/models/openai';
import { DefaultAccounts } from '../../../providers/contract/service/accounts.js';
import { ModelPreferences } from '../../../native-harness/contract/service/models.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadStack } from '../threadParts.js';
import { ENTRY_KINDS } from '../composed.js';

const anthropic = Effect.fnUntraced(function* (uuid: string): Effect.fn.Return<SubscriptionCredential> {
  return {
    accessToken: `token-${uuid}`,
    refreshToken: `refresh-${uuid}`,
    expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
    scope: 'user:inference',
    account: { uuid, email: `${uuid}@example.com` },
    organization: { uuid: `org-${uuid}`, name: 'Example' },
  };
});

class SelectionProject extends Context.Service<SelectionProject, number>()('testing/SelectionProject') {}

const world = Effect.gen(function* () {
  const door = yield* DoorFixture;
  const projectId = yield* SelectionProject;
  const owners = door.runtime.owners;
  const { db } = Context.get(door.runtime.graph, MachineStore);
  const units = Context.get(door.runtime.graph, MachineUnits);
  const records = yield* makeThreadRecords;
  const { threads } = yield* threadStack({ db, units, records, kinds: ENTRY_KINDS });
  const selection = Context.get(owners, ModelPreferences);
  const defaults = Context.get(owners, DefaultAccounts);
  yield* Effect.forEach([SUBSCRIPTION_PROVIDER, OPENAI_OAUTH_PROVIDER, 'opencode-go'], (provider) =>
    defaults.saveDefaultAccount(provider, null),
  );
  yield* selection.setModelDefaults({ provider: SUBSCRIPTION_PROVIDER, model: 'claude-opus-5-5', reasoning: 'high', account: null });
  const turns = turnsOf(owners);
  const births = birthsOf(owners);
  const create = (input: Parameters<typeof births.create>[0]) =>
    Effect.acquireRelease(births.create(input), (born) => turns.delete(born.thread.id, projectId).pipe(Effect.asVoid, Effect.orDie));
  return {
    projectId,
    tokens: {
      ...door.runtime.tokens,
      add: (provider: string, credential: unknown) =>
        Effect.acquireRelease(door.runtime.tokens.add(provider, credential), (account) =>
          door.runtime.signIns.remove(provider, account).pipe(Effect.orDie),
        ),
    },
    keys: door.runtime.consoleKeys,
    threads: threads.list,
    defaults,
    selection,
    create,
    turns,
  };
});

const fixture = Layer.effectContext(
  Effect.gen(function* () {
    const door = yield* DoorFixture;
    return Context.add(door.runtime.graph, SelectionProject, yield* door.stealthProject());
  }),
).pipe(Layer.provideMerge(doorFixture({ own: 'it signs accounts in' })));

layer(fixture, { excludeTestServices: true })('account selection', (it) => {
  it.effect('the first stored account of a provider becomes its default, and a second never moves it', () =>
    Effect.gen(function* () {
      const { defaults, tokens } = yield* world;
      const standing = (provider: string) => Effect.map(defaults.defaultAccount(provider), (held): string | null => held.account);

      expect(yield* standing(SUBSCRIPTION_PROVIDER)).toBeNull();
      const first = yield* tokens.add(SUBSCRIPTION_PROVIDER, yield* anthropic('first'));
      yield* defaults.adoptDefaultAccount(SUBSCRIPTION_PROVIDER, first);
      expect(yield* standing(SUBSCRIPTION_PROVIDER)).toBe(first);

      const second = yield* tokens.add(SUBSCRIPTION_PROVIDER, yield* anthropic('second'));
      yield* defaults.adoptDefaultAccount(SUBSCRIPTION_PROVIDER, second);
      expect(yield* standing(SUBSCRIPTION_PROVIDER)).toBe(first);

      expect(yield* standing(OPENAI_OAUTH_PROVIDER)).toBeNull();
      const openai = yield* tokens.add(OPENAI_OAUTH_PROVIDER, {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
        accountId: AccountKey.make('codex'),
      });
      yield* defaults.adoptDefaultAccount(OPENAI_OAUTH_PROVIDER, openai);
      expect(yield* standing(OPENAI_OAUTH_PROVIDER)).toBe(openai);
    }),
  );

  it.effect('a console provider stores accounts a selection can name, and adopting one leaves the second alone', () =>
    Effect.gen(function* () {
      const { defaults, keys } = yield* world;
      const standing = (provider: string) => Effect.map(defaults.defaultAccount(provider), (held): string | null => held.account);

      expect(yield* standing('opencode-go')).toBeNull();
      const first = yield* keys.save('opencode-go', 'oc_sk_first');
      yield* defaults.adoptDefaultAccount('opencode-go', AccountKey.make(first));
      expect(yield* standing('opencode-go')).toBe(first);

      const second = yield* keys.save('opencode-go', 'oc_sk_second');
      yield* defaults.adoptDefaultAccount('opencode-go', AccountKey.make(second));
      expect(yield* standing('opencode-go')).toBe(first);

      yield* defaults.saveDefaultAccount('opencode-go', null);
      const third = yield* keys.save('opencode-go', 'oc_sk_third');
      yield* defaults.adoptDefaultAccount('opencode-go', AccountKey.make(third));
      expect(yield* standing('opencode-go')).toBe(third);

      yield* keys.remove('opencode-go', third);
      yield* defaults.adoptDefaultAccount('opencode-go', AccountKey.make(second));
      expect(yield* standing('opencode-go')).toBe(second);

      yield* defaults.saveDefaultAccount('opencode-go', second);
      expect(yield* standing('opencode-go')).toBe(second);
      expect(yield* Effect.flip(defaults.saveDefaultAccount('opencode-go', 'never-pasted'))).toMatchObject({ code: 'unknown-account' });

      const read = yield* defaults.defaultAccount('opencode-go');
      const moved = yield* defaults.saveDefaultAccount('opencode-go', first, read.revision);
      expect(moved).toEqual({ account: AccountKey.make(first), revision: read.revision + 1 });
      const stale = yield* Effect.flip(defaults.saveDefaultAccount('opencode-go', second, read.revision));
      expect(stale).toMatchObject({ code: 'stale-revision' });
      expect(yield* standing('opencode-go')).toBe(first);
    }),
  );

  it.effect('a thread that named no account stays pinless, through birth and through the door that opens its run', () =>
    Effect.gen(function* () {
      const { projectId, create, turns, defaults, threads, tokens } = yield* world;
      const chosen = yield* tokens.add(SUBSCRIPTION_PROVIDER, yield* anthropic('standing'));
      yield* defaults.adoptDefaultAccount(SUBSCRIPTION_PROVIDER, chosen);

      const born = yield* create({ projectId, createdBySessionId: null });
      expect((yield* threads.find(born.thread.id, 'operator'))?.account).toBeNull();
      yield* turns.send(born.thread.id, projectId, 'first words');
      expect((yield* threads.find(born.thread.id, 'operator'))?.account).toBeNull();
    }),
  );

  it.effect('a birth that names an account pins it, and an unknown key is refused there', () =>
    Effect.gen(function* () {
      const { projectId, create, defaults, threads, tokens } = yield* world;
      const stored = yield* tokens.add(SUBSCRIPTION_PROVIDER, yield* anthropic('named'));
      yield* defaults.adoptDefaultAccount(SUBSCRIPTION_PROVIDER, stored);

      const born = yield* create({ projectId, createdBySessionId: null, account: String(stored) });
      expect((yield* threads.find(born.thread.id, 'operator'))?.account).toBe(String(stored));
      expect(yield* Effect.flip(create({ projectId, createdBySessionId: null, account: 'nope' }))).toMatchObject({
        code: 'unknown-account',
      });
    }),
  );

  it.effect('a provider change clears an account the new provider does not store', () =>
    Effect.gen(function* () {
      const { projectId, create, defaults, selection, threads, tokens } = yield* world;
      const claude = yield* tokens.add(SUBSCRIPTION_PROVIDER, yield* anthropic('claude'));
      yield* defaults.adoptDefaultAccount(SUBSCRIPTION_PROVIDER, claude);
      yield* tokens.add(OPENAI_OAUTH_PROVIDER, {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
        accountId: AccountKey.make('codex'),
      });

      const born = yield* create({ projectId, createdBySessionId: null, account: String(claude) });
      expect((yield* threads.find(born.thread.id, 'operator'))?.account).toBe(String(claude));
      yield* selection.setModelSettings(born.thread.id, projectId, {
        provider: OPENAI_OAUTH_PROVIDER,
        model: 'gpt-5.6-sol',
        reasoning: 'high',
        switches: {},
      });
      expect((yield* threads.find(born.thread.id, 'operator'))?.account).toBeNull();

      yield* selection.setModelSettings(born.thread.id, projectId, {
        provider: SUBSCRIPTION_PROVIDER,
        model: 'claude-fable-5-1',
        reasoning: 'xhigh',
        switches: {},
      });
      expect((yield* threads.find(born.thread.id, 'operator'))?.account).toBeNull();
    }),
  );
});
