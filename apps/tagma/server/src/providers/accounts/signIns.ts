import { AccountKey } from '@runlith/llm/models/authStatus';
import { type AccountRow, parseStoredCredential, type StoredCredential } from '@runlith/llm/oauth/credential';
import type { TokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { makeProviderSignIn, providerAuthStatus } from '@runlith/llm/oauth/ProviderSignIn';
import type { TokenStoreFault } from '@runlith/llm/oauth/storeFailure';
import type { DeviceSignIn, KeySignIn, LoopbackSignIn, PasteChallenge, SubscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { Clock, Deferred, Effect, Exit, FiberMap, type Layer, Option, type Scope, Semaphore } from 'effect';
import type { HttpClient } from 'effect/http';
import type { ConsoleKeyFailure, ConsoleKeyStore } from '../credentials/consoleKeys.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { type DefaultAccounts, unknownAccount } from '../contract/service/accounts.js';
import type { AccountQuota } from '../contract/service/quota.js';
import { SignIns } from '../contract/service/signIns.js';
import { credentialRefusal, isTokenFault } from '../credentials/refusal.js';
import { type SubscriptionProvider, subscriptionProvider } from '../registered.js';
import type { ProviderRegistry } from '../contract/service/registry.js';
import { consoleKeyLabel } from '../contract/wire/accounts.js';
import type { ModelCatalogs } from '../catalogs.js';

const SIGN_IN_SCOPE = 'tagma';

export type VendorWire = Layer.Layer<HttpClient.HttpClient>;

type Pending =
  | { readonly kind: 'loopback'; readonly result: Deferred.Deferred<StoredCredential, GateRefusal> }
  | { readonly kind: 'device'; readonly flow: DeviceSignIn<StoredCredential> }
  | { readonly kind: 'paste'; readonly challenge: PasteChallenge<StoredCredential> }
  | { readonly kind: 'key'; readonly flow: KeySignIn<StoredCredential> }
  | { readonly kind: 'console-key' };

const noSignIn = (provider: string) =>
  new GateRefusal('no-sign-in', `no sign-in is pending for ${provider}`, [`begin a ${provider} sign-in before asking for its completion`]);

const signInFailed = (provider: string, reason: string) => new GateRefusal('sign-in-failed', reason, [`begin a new ${provider} sign-in`]);

const mapSignInFailed = <A, E extends { readonly message: string }>(
  provider: string,
  work: Effect.Effect<A, E>,
): Effect.Effect<A, GateRefusal> => Effect.mapError(work, (cause) => signInFailed(provider, cause.message));

const accountStatus = (provider: string, accounts: SubscriptionAccounts, row: AccountRow, defaultAccount: string | null) => ({
  ...providerAuthStatus(provider, row, accounts),
  default: String(row.key) === defaultAccount,
});

const missingAccount = (provider: string, account: string, rows: ReadonlyArray<{ readonly key: AccountKey }>) =>
  unknownAccount(provider, account, rows.map((row) => String(row.key)).sort());

const store = <A>(what: string, read: Effect.Effect<A, TokenStoreFault>): Effect.Effect<A, GateRefusal> =>
  Effect.mapError(read, (cause) => credentialRefusal(what, cause));

const credentialsHeld = <A, E>(what: string, work: Effect.Effect<A, E>): Effect.Effect<A, Exclude<E, TokenStoreFault> | GateRefusal> =>
  Effect.catchIf(work, isTokenFault, (cause) => Effect.fail(credentialRefusal(what, cause))) as Effect.Effect<
    A,
    Exclude<E, TokenStoreFault> | GateRefusal
  >;

const keyFile = <A>(what: string, work: Effect.Effect<A, ConsoleKeyFailure>): Effect.Effect<A, GateRefusal | StoreFailure> =>
  credentialsHeld(what, work);

const loopbackFlow = (
  provider: string,
  flow: LoopbackSignIn<StoredCredential>,
  ready: Deferred.Deferred<string, GateRefusal>,
  wire: VendorWire,
): Effect.Effect<StoredCredential, GateRefusal> =>
  flow
    .run((authorizeUrl) => {
      Deferred.doneUnsafe(ready, Effect.succeed(authorizeUrl));
    })
    .pipe(
      Effect.mapError(
        (error) =>
          new GateRefusal('sign-in-failed', error.message, [
            `begin a new ${provider} sign-in; an authorization code belongs to one loopback listener`,
          ]),
      ),
      Effect.provide(wire),
    );

export const signIns = Effect.fnUntraced(function* (
  tokens: TokenStore,
  keys: ConsoleKeyStore,
  defaults: DefaultAccounts['Service'],
  quota: AccountQuota['Service'],
  wire: VendorWire,
  consoles: () => ReadonlyArray<string>,
  registry: ProviderRegistry['Service'],
  catalogs: ModelCatalogs['Service'],
) {
  const modelKeyed = (provider: string): boolean =>
    registry.current().wires.providers.some((wire) => wire.id === provider && wire.auth === 'api-key');
  const consoleSigned = (provider: string): boolean =>
    registry
      .current()
      .served.providers.some(
        (row) =>
          row.id === provider &&
          row.auth === 'api-key' &&
          row.signInMethods.includes('key') &&
          registry.current().models.providers.find((wire) => wire.id === provider)?.accounts === undefined,
      );
  const subscribed = () =>
    registry
      .current()
      .models.providers.flatMap((provider) =>
        (provider.kind === 'harness' && provider.auth === 'cli') || provider.accounts === undefined
          ? []
          : [{ id: provider.id, accounts: provider.accounts }],
      );
  const signInProvider = (named: string | undefined) => subscriptionProvider(registry, named);
  const keyed = (provider: string): Effect.Effect<void, GateRefusal> =>
    consoles().includes(provider)
      ? Effect.void
      : Effect.fail(new GateRefusal('unknown-provider', `${provider} keeps no console key`, [`name one of: ${consoles().join(', ')}`]));
  const ownedHere = (provider: string, account: string): Effect.Effect<void, GateRefusal> =>
    Effect.flatMap(store(`read its ${provider} accounts`, tokens.owns(provider, AccountKey.make(account))), (owned) =>
      owned
        ? Effect.void
        : Effect.fail(
            new GateRefusal('account-borrowed', `${provider} account ${account} is borrowed from the CLI that holds its sign-in.`, [
              'remove or rename it under the provider whose CLI holds the sign-in',
            ]),
          ),
    );
  const fibers = yield* FiberMap.make<string, void>();
  const pending = new Map<string, Pending>();
  const gate = Semaphore.makeUnsafe(1);
  const signIn = makeProviderSignIn({ wire });

  const ingested = Effect.fnUntraced(function* ({ id: provider, accounts }: SubscriptionProvider, account: AccountKey) {
    yield* credentialsHeld(`adopt the ${provider} account`, defaults.adoptDefaultAccount(provider, account));
    const rows = yield* store(`read its ${provider} accounts`, tokens.accounts(provider));
    const row = rows.find((candidate) => candidate.key === account);
    if (!row) return yield* missingAccount(provider, String(account), rows);
    yield* quota.refresh(provider, account);
    const { account: defaultAccount } = yield* defaults.defaultAccount(provider);
    return accountStatus(provider, accounts, row, defaultAccount);
  });

  const kept = (subscription: SubscriptionProvider, what: string, credential: unknown) =>
    Effect.flatMap(store(what, tokens.add(subscription.id, credential)), (account) => ingested(subscription, account)).pipe(
      Effect.tap(() => catalogs.refresh(subscription.id)),
    );

  const beginLoopback = (provider: string, flow: LoopbackSignIn<StoredCredential>) =>
    gate.withPermits(1)(
      Effect.gen(function* () {
        const key = `${SIGN_IN_SCOPE}:${provider}`;
        pending.delete(provider);
        yield* FiberMap.remove(fibers, key);
        const ready = yield* Deferred.make<string, GateRefusal>();
        const result = yield* Deferred.make<StoredCredential, GateRefusal>();
        signIn.forget(SIGN_IN_SCOPE, provider);
        pending.set(provider, { kind: 'loopback', result });
        const run = loopbackFlow(provider, flow, ready, wire).pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Effect.all([Deferred.done(result, exit), Exit.isFailure(exit) ? Deferred.failCause(ready, exit.cause) : Effect.void]).pipe(
              Effect.asVoid,
            ),
          ),
        );
        yield* FiberMap.run(fibers, key, run);
        return { flow: 'loopback' as const, authorizeUrl: yield* Deferred.await(ready) };
      }),
    );

  const completeLoopback = (subscription: SubscriptionProvider) =>
    gate.withPermits(1)(
      Effect.gen(function* () {
        const provider = subscription.id;
        const state = pending.get(provider);
        if (state?.kind !== 'loopback') return yield* noSignIn(provider);
        const polled = yield* Deferred.poll(state.result);
        if (Option.isNone(polled)) return { pending: true as const, message: 'Waiting for authorization in the browser.' };
        pending.delete(provider);
        return yield* kept(subscription, `store the ${provider} sign-in`, yield* polled.value);
      }),
    );

  const completeDevice = (subscription: SubscriptionProvider) =>
    gate.withPermits(1)(
      Effect.gen(function* () {
        const { id: provider } = subscription;
        const state = pending.get(provider);
        if (state?.kind !== 'device') return yield* noSignIn(provider);
        const answered = yield* mapSignInFailed(
          provider,
          signIn
            .complete(SIGN_IN_SCOPE, provider, state.flow)
            .pipe(
              Effect.catchTag('ProviderSignInPendingError', (cause) => Effect.succeed({ pending: true as const, message: cause.message })),
            ),
        );
        if ('pending' in answered) return answered;
        pending.delete(provider);
        return yield* kept(subscription, `store the ${provider} sign-in`, answered);
      }),
    );

  const keepKey = Effect.fnUntraced(function* (provider: string, key: string, replaces?: string) {
    yield* keyed(provider);
    const trimmed = key.trim();
    if (trimmed === '')
      return yield* new GateRefusal('empty-key', 'a console key is not empty', ['paste the Model API key this provider issued']);
    const account = yield* keyFile(`store the ${provider} console key`, keys.save(provider, trimmed, replaces));
    yield* credentialsHeld(`adopt the ${provider} key`, defaults.adoptDefaultAccount(provider, AccountKey.make(account)));
    if (modelKeyed(provider)) yield* quota.refresh(provider, AccountKey.make(account));
    return { provider, account, updatedAt: yield* Clock.currentTimeMillis };
  });

  return SignIns.of({
    status: () =>
      Effect.map(
        Effect.forEach(
          subscribed(),
          Effect.fnUntraced(function* ({ id: provider, accounts }) {
            const rows = yield* store(`read its ${provider} accounts`, tokens.accounts(provider));
            const { account: defaultAccount } = yield* defaults.defaultAccount(provider);
            return [provider, rows.map((row) => accountStatus(provider, accounts, row, defaultAccount))] as const;
          }),
        ),
        (entries) => Object.fromEntries(entries) as never,
      ),

    begin: Effect.fn('SignIns.begin')(function* (named, _projectId, _account, method) {
      if (consoleSigned(named)) {
        if (method !== undefined && method !== 'key')
          return yield* signInFailed(named, `The provider does not declare sign-in method ${method}.`);
        return yield* gate.withPermits(1)(
          Effect.sync(() => {
            pending.set(named, { kind: 'console-key' });
            return { flow: 'key' as const };
          }),
        );
      }
      const { id: provider, accounts } = yield* signInProvider(named);
      const flow = method === undefined ? accounts.signIns[0] : accounts.signIns.find((flow) => flow.kind === method);
      if (flow === undefined) return yield* signInFailed(provider, `The provider does not declare sign-in method ${method}.`);
      if (flow.kind === 'loopback') return yield* beginLoopback(provider, flow);
      return yield* gate.withPermits(1)(
        Effect.gen(function* () {
          pending.delete(provider);
          yield* FiberMap.remove(fibers, `${SIGN_IN_SCOPE}:${provider}`);
          signIn.forget(SIGN_IN_SCOPE, provider);
          if (flow.kind === 'paste') {
            const challenge = yield* mapSignInFailed(provider, flow.begin().pipe(Effect.provide(wire)));
            pending.set(provider, { kind: 'paste', challenge });
            return { flow: 'paste' as const, authorizeUrl: challenge.authorizeUrl };
          }
          if (flow.kind === 'key') {
            pending.set(provider, { kind: 'key', flow });
            return { flow: 'key' as const };
          }
          const begun = yield* mapSignInFailed(provider, signIn.begin(SIGN_IN_SCOPE, provider, flow));
          pending.set(provider, { kind: 'device', flow });
          return begun;
        }),
      );
    }),

    complete: Effect.fn('SignIns.complete')(function* (named, _account, code) {
      if (consoleSigned(named) && pending.get(named)?.kind !== 'console-key') return yield* noSignIn(named);
      if (pending.get(named)?.kind === 'console-key')
        return yield* gate.withPermits(1)(
          Effect.gen(function* () {
            if (pending.get(named)?.kind !== 'console-key') return yield* noSignIn(named);
            const saved = yield* keepKey(named, code ?? '');
            pending.delete(named);
            const standing = yield* defaults.defaultAccount(named);
            return {
              account: AccountKey.make(saved.account),
              provider: named,
              label: consoleKeyLabel(saved.account),
              expiresAt: null,
              origin: { kind: 'own' as const },
              addedAt: saved.updatedAt,
              default: standing.account === saved.account,
            };
          }),
        );
      return yield* Effect.flatMap(signInProvider(named), (subscription) => {
        const state = pending.get(subscription.id);
        if (state?.kind === 'loopback') return completeLoopback(subscription);
        if (state?.kind === 'device') return completeDevice(subscription);
        return gate.withPermits(1)(
          Effect.gen(function* () {
            const state = pending.get(subscription.id);
            if (state === undefined || (state.kind !== 'paste' && state.kind !== 'key')) return yield* noSignIn(subscription.id);
            if (code === undefined || code.trim() === '')
              return yield* signInFailed(subscription.id, 'Supply the authorization code or key.');
            const work = state.kind === 'paste' ? state.challenge.complete(code.trim()) : state.flow.store(code.trim());
            const credential = yield* mapSignInFailed(subscription.id, work.pipe(Effect.provide(wire)));
            const account = yield* kept(subscription, `store the ${subscription.id} sign-in`, credential);
            pending.delete(subscription.id);
            return account;
          }),
        );
      });
    }),

    remove: (named, account) =>
      gate.withPermits(1)(
        Effect.gen(function* () {
          const found = yield* Effect.result(signInProvider(named));
          if (found._tag === 'Failure') {
            if (found.failure.code !== 'provider-not-installed') return yield* found.failure;
            const held = yield* store(`read its ${named} accounts`, tokens.held(named));
            if (!held.some((candidate) => candidate.key === account)) return yield* found.failure;
            const standing = yield* defaults.forgetAccount(named, AccountKey.make(account));
            yield* store(`remove the ${named} account`, tokens.remove(named, AccountKey.make(account)));
            yield* quota.refresh(named, AccountKey.make(account));
            return { provider: named, removed: AccountKey.make(account), default: standing.account };
          }
          const { id: provider, accounts } = found.success;
          const rows = yield* store(`read its ${provider} accounts`, tokens.held(provider));
          if (!rows.some((candidate) => candidate.key === account)) return yield* missingAccount(provider, account, rows);
          yield* ownedHere(provider, account);
          const standing = yield* defaults.defaultAccount(provider);
          const remaining = rows.filter((candidate) => candidate.key !== account);
          const nextDefault = standing.account === account ? (remaining[0]?.key ?? null) : standing.account;
          if (nextDefault !== standing.account) {
            yield* credentialsHeld(`move the ${provider} default`, defaults.saveDefaultAccount(provider, nextDefault, standing.revision));
          }
          pending.delete(provider);
          yield* FiberMap.remove(fibers, `${SIGN_IN_SCOPE}:${provider}`);
          signIn.forget(SIGN_IN_SCOPE, provider);
          yield* store(`remove the ${provider} account`, tokens.remove(provider, AccountKey.make(account)));
          yield* quota.refresh(provider, AccountKey.make(account));
          return { provider, removed: AccountKey.make(account), default: nextDefault };
        }),
      ),

    rename: (named, account, label) =>
      gate.withPermits(1)(
        Effect.gen(function* () {
          const subscription = yield* signInProvider(named);
          const provider = subscription.id;
          const rows = yield* store(`read its ${provider} accounts`, tokens.held(provider));
          if (!rows.some((row) => row.key === account)) return yield* missingAccount(provider, account, rows);
          yield* ownedHere(provider, account);
          yield* store(`relabel the ${provider} account`, tokens.relabel(provider, AccountKey.make(account), label));
          return yield* ingested(subscription, AccountKey.make(account));
        }),
      ),

    keepCredential: (named, payload) =>
      gate.withPermits(1)(
        Effect.gen(function* () {
          const subscription = yield* signInProvider(named);
          const provider = subscription.id;
          const credential = yield* parseStoredCredential(provider, subscription.accounts.credential, payload).pipe(
            Effect.mapError(
              (invalid) => new GateRefusal('credential-shape', invalid.message, ['post the credential the flow answered with']),
            ),
          );
          return yield* kept(subscription, `store the ${provider} credential`, credential);
        }),
      ),

    saveConsoleKey: (provider, key, replaces) => gate.withPermits(1)(keepKey(provider, key, replaces)),

    removeConsoleKey: (provider, account) =>
      gate.withPermits(1)(
        Effect.gen(function* () {
          yield* keyed(provider);
          yield* keyFile(`remove the ${provider} console key`, keys.remove(provider, account));
          const standing = yield* defaults.defaultAccount(provider);
          if (standing.account === account) {
            const remaining = yield* keyFile(`read the ${provider} console keys`, keys.accounts(provider));
            const next = remaining.length === 1 ? remaining[0]!.account : null;
            yield* credentialsHeld(`move the ${provider} default`, defaults.saveDefaultAccount(provider, next, standing.revision));
          }
          if (modelKeyed(provider)) yield* quota.refresh(provider);
          return { provider, account };
        }),
      ),

    consoleKeys: () =>
      Effect.forEach(
        consoles().filter((provider) => !modelKeyed(provider)),
        Effect.fnUntraced(function* (provider) {
          const rows = yield* keyFile(`read the ${provider} console keys`, keys.accounts(provider));
          const standing = yield* defaults.defaultAccount(provider);
          return {
            provider,
            keys: rows.map((row) => ({
              account: row.account,
              label: consoleKeyLabel(row.account),
              default: row.account === standing.account,
            })),
          };
        }),
      ),
  });
});
