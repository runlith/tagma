import { testTokens } from '../testing/tokens.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { SubscriptionCredential } from '@runlith/builtin-catalog/subscription/provider';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { Effect, Layer } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { makeConsoleKeyStore } from './consoleKeys.js';
import { consoleKeyFile } from './consoleKeyFile.js';
import { makeOperatorCredentials, type OperatorCredentials } from './operator.js';

const accountUuid = async (signing: OperatorCredentials) =>
  ((await signing.credential('operator', 'subscription')) as SubscriptionCredential).account.uuid;

const rejection = (work: Promise<unknown>) =>
  Effect.map(Effect.flip(Effect.tryPromise({ try: () => work, catch: (cause) => cause as Error })), (error) => error.message);

const workdir = (prefix: string) => Effect.promise(() => mkdtemp(join(tmpdir(), prefix)));

function anthropicCredential(account: string, accessToken: string): SubscriptionCredential {
  return {
    accessToken,
    refreshToken: `refresh-${account}`,
    expiresAt: Date.now() + 60 * 60 * 1_000,
    scope: 'user:inference',
    account: { uuid: account, email: `${account}@example.com` },
    organization: { uuid: `org-${account}`, name: 'Example' },
  };
}

it.live('OperatorCredentials resolves an absent account by default, then by the only row, and never guesses', () =>
  Effect.gen(function* () {
    const directory = yield* workdir('tagma-operator-credentials-');
    const tokens = testTokens(join(directory, 'tokens.json'));
    let defaultAccount: string | null = null;
    const signing = () =>
      makeOperatorCredentials({
        tokens,
        defaultAccount: () => Effect.succeed({ account: defaultAccount === null ? null : AccountKey.make(defaultAccount), revision: 0 }),
      });

    const first = yield* tokens.add('subscription', anthropicCredential('first', 'token-first'));
    expect(yield* Effect.promise(() => signing().accessToken('operator', 'subscription'))).toBe('token-first');
    expect(yield* Effect.promise(() => accountUuid(signing()))).toBe('first');

    const second = yield* tokens.add('subscription', anthropicCredential('second', 'token-second'));
    const ambiguous = yield* rejection(signing().accessToken('operator', 'subscription'));
    expect(ambiguous).toContain('choose one');
    expect(ambiguous).toContain(first);
    expect(ambiguous).toContain(second);

    defaultAccount = second;
    expect(yield* Effect.promise(() => signing().accessToken('operator', 'subscription'))).toBe('token-second');
    expect(yield* Effect.promise(() => accountUuid(signing()))).toBe('second');
    expect(yield* Effect.promise(() => signing().accessToken('operator', 'subscription', first))).toBe('token-first');

    yield* tokens.remove('subscription', second);
    expect(yield* rejection(signing().accessToken('operator', 'subscription'))).toContain(second);
    expect(yield* rejection(signing().accessToken('operator', 'subscription', 'missing'))).toContain('missing');
  }),
);

it.live('one request keeps the row it resolved even when the owner default moves under it', () =>
  Effect.gen(function* () {
    const directory = yield* workdir('tagma-operator-credentials-moving-');
    const tokens = testTokens(join(directory, 'tokens.json'));
    const first = yield* tokens.add('subscription', anthropicCredential('first', 'token-first'));
    const second = yield* tokens.add('subscription', anthropicCredential('second', 'token-second'));
    let defaultAccount = first;
    const defaulted = () => Effect.succeed({ account: AccountKey.make(defaultAccount), revision: 0 });

    const request = makeOperatorCredentials({ tokens, defaultAccount: defaulted });
    const selected = yield* request.accountKey('subscription');
    const bearer = yield* Effect.promise(() => request.accessToken('operator', 'subscription'));
    defaultAccount = second;
    const uuid = yield* Effect.promise(() => accountUuid(request));

    expect(bearer).toBe('token-first');
    expect(uuid).toBe('first');
    expect(selected).toBe(first);
    expect(request.selectedAccount).toBe(first);
    expect(yield* request.accountKey('subscription')).toBe(first);
    const next = makeOperatorCredentials({ tokens, defaultAccount: defaulted });
    expect(yield* Effect.promise(() => next.accessToken('operator', 'subscription'))).toBe('token-second');
    expect(yield* next.accountKey('subscription')).toBe(second);
  }),
);

const layers = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations))),
);

const consoleWorld = Effect.fnUntraced(function* (prefix: string) {
  const [store, units] = yield* Effect.all([MachineStore, MachineUnits]);
  const directory = yield* workdir(prefix);
  return {
    keys: makeConsoleKeyStore({ db: store.db, units, file: consoleKeyFile(directory) }),
    tokens: testTokens(join(directory, 'tokens.json')),
  };
});

it.live('apiKey spends the stored console key its call names, and refuses by name when it cannot', () =>
  Effect.gen(function* () {
    const { keys, tokens } = yield* consoleWorld('tagma-console-key-');
    const signing = (held?: typeof keys) =>
      makeOperatorCredentials({ tokens, defaultAccount: () => Effect.succeed({ account: null, revision: 0 }), keys: held });

    expect(yield* rejection(signing().apiKey('operator', 'muse'))).toContain('holds no console keys');
    expect(yield* rejection(signing(keys).apiKey('operator', 'muse'))).toContain('paste one in Settings');

    const museAccount = yield* keys.save('muse', 'LLM-pasted');
    expect(yield* Effect.promise(() => signing(keys).apiKey('operator', 'muse'))).toBe('LLM-pasted');
    expect(yield* Effect.promise(() => signing(keys).apiKey('operator', 'muse', museAccount))).toBe('LLM-pasted');
    expect(yield* rejection(signing(keys).apiKey('operator', 'opencode-go'))).toContain('paste one in Settings');

    const first = yield* keys.save('opencode-go', 'oc_sk_first');
    const second = yield* keys.save('opencode-go', 'oc_sk_second');
    expect(yield* Effect.promise(() => signing(keys).apiKey('operator', 'opencode-go', second))).toBe('oc_sk_second');
    const ambiguous = yield* rejection(signing(keys).apiKey('operator', 'opencode-go'));
    expect(ambiguous).toContain('none is chosen');
    expect(ambiguous).toContain(first);
  }).pipe(Effect.provide(layers)),
);

it.live('a console call with no account named spends the key the owner chose', () =>
  Effect.gen(function* () {
    const { keys, tokens } = yield* consoleWorld('tagma-console-default-');
    let chosen: string | null = null;
    const signing = () =>
      makeOperatorCredentials({
        tokens,
        defaultAccount: () => Effect.succeed({ account: chosen === null ? null : AccountKey.make(chosen), revision: 0 }),
        keys,
      });

    const first = yield* keys.save('opencode-go', 'oc_sk_first');
    const second = yield* keys.save('opencode-go', 'oc_sk_second');
    expect(yield* rejection(signing().apiKey('operator', 'opencode-go'))).toContain('none is chosen');

    chosen = second;
    const signed = signing();
    expect(yield* Effect.promise(() => signed.apiKey('operator', 'opencode-go'))).toBe('oc_sk_second');
    expect(String(yield* signing().accountKey('opencode-go'))).toBe(second);
    expect(signed.selectedAccount).toBe(second);

    chosen = first;
    expect(yield* Effect.promise(() => signing().apiKey('operator', 'opencode-go'))).toBe('oc_sk_first');
    expect(yield* Effect.promise(() => signing().apiKey('operator', 'opencode-go', second))).toBe('oc_sk_second');
  }).pipe(Effect.provide(layers)),
);

it.live('accountKey answers a console provider with the account its key signs under', () =>
  Effect.gen(function* () {
    const { keys, tokens } = yield* consoleWorld('tagma-console-identity-');
    const reading = () => makeOperatorCredentials({ tokens, defaultAccount: () => Effect.succeed({ account: null, revision: 0 }), keys });
    const identity = (named?: string) => Effect.map(reading().accountKey('opencode-go', named), String);

    const only = yield* keys.save('opencode-go', 'oc_sk_only');
    expect(yield* identity()).toBe(only);
    expect(yield* identity(only)).toBe(only);

    const other = yield* keys.save('opencode-go', 'oc_sk_other');
    expect(yield* identity(other)).toBe(other);
    expect((yield* Effect.flip(identity())).message).toContain('none is chosen');
  }).pipe(Effect.provide(layers)),
);
