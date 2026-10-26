import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { SUBSCRIPTION_PROVIDER } from '@runlith/builtin-catalog/subscription/description';
import { OPENAI_OAUTH_PROVIDER } from '@runlith/adapter-openai/models/openai';
import { SUBSCRIPTION_TOKEN_URL } from '@runlith/builtin-catalog/subscription/provider';
import { DEVICE_GRANT, DEVICE_PROVIDER } from '../deviceAdapter.js';
import { QuotaObservation, QuotaUnsupported, QuotaWindow } from '@runlith/llm/schema/quota';
import { Clock, Context, Data, Effect, Layer, Schedule } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import type { AccountQuotaProvider } from '../../../providers/quota/ledger.js';
import { DefaultAccounts } from '../../../providers/contract/service/accounts.js';
import { builtinRegistry } from '../providerCatalog.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { makeDoorWorld } from '../doorFixture.js';
import { keepAccountDefaults } from '../claudeLogin.js';

class SignInPending extends Data.TaggedError('SignInPending')<{ readonly message: string }> {}

const quotaProvider: AccountQuotaProvider = {
  id: OPENAI_OAUTH_PROVIDER,
  quota: {
    fromHeaders: () => null,
    read: () =>
      Effect.map(
        Clock.currentTimeMillis,
        (at) =>
          new QuotaObservation({
            observedAt: new Date(at),
            source: 'usage',
            windows: [new QuotaWindow({ kind: 'session', usedPercent: 17 })],
          }),
      ),
  },
};
const vendor = (url: string): Response => {
  if (url === SUBSCRIPTION_TOKEN_URL) {
    return Response.json({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expires_in: 3_600,
      scope: 'user:profile user:inference',
      account: { uuid: 'account-1', email_address: 'operator@example.com' },
      organization: { uuid: 'organization-1', name: 'Example' },
    });
  }
  if (url === DEVICE_GRANT.deviceAuthorizationUrl) {
    return Response.json({
      device_code: 'device-code-1',
      user_code: 'WXYZ-1234',
      verification_uri: 'https://device.invalid/activate',
      expires_in: 600,
      interval: 5,
    });
  }
  if (url === DEVICE_GRANT.tokenUrl) return Response.json({ error: 'access_denied' }, { status: 400 });
  return new Response(`no vendor answers ${url} in this test`, { status: 599 });
};
const vendorWire = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request, url) => Effect.succeed(HttpClientResponse.fromWeb(request, vendor(url.toString())))),
);

const setup = Effect.gen(function* () {
  const authorize = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 0,
        fetch(request) {
          const url = new URL(request.url);
          const redirectUri = url.searchParams.get('redirect_uri');
          const state = url.searchParams.get('state');
          if (!redirectUri || !state) return new Response('missing redirect', { status: 400 });
          const callback = new URL(redirectUri);
          callback.searchParams.set('code', 'test-code');
          callback.searchParams.set('state', state);
          return Response.redirect(callback.toString(), 302);
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  );
  const registry = Context.get(yield* Layer.build(builtinRegistry), ProviderRegistry);
  const catalog = yield* registry.catalog;
  const consoleQuotaProviders: readonly AccountQuotaProvider[] = catalog.wires.providers
    .filter((provider) => provider.auth === 'api-key')
    .map(({ id }) => ({ id, quota: { fromHeaders: () => null, read: () => Effect.fail(new QuotaUnsupported()) } }));
  const world = yield* makeDoorWorld({ quotaProviders: [quotaProvider, ...consoleQuotaProviders], vendorWire });
  const providers = [SUBSCRIPTION_PROVIDER, OPENAI_OAUTH_PROVIDER, 'muse', 'opencode-go'];
  yield* keepAccountDefaults(world, ...providers);
  const previous = yield* Effect.forEach(providers, (provider) =>
    Effect.gen(function* () {
      return {
        provider,
        tokens: new Set((yield* world.runtime.tokens.held(provider)).map((row) => row.key)),
        keys: new Set((yield* world.runtime.consoleKeys.accounts(provider)).map((row) => row.account)),
      };
    }),
  );
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      for (const kept of previous) {
        for (const row of yield* world.runtime.tokens.held(kept.provider))
          if (!kept.tokens.has(row.key)) yield* world.runtime.signIns.remove(kept.provider, row.key);
        for (const row of yield* world.runtime.consoleKeys.accounts(kept.provider))
          if (!kept.keys.has(row.account)) yield* world.runtime.signIns.removeConsoleKey(kept.provider, row.account);
      }
    }).pipe(Effect.orDie),
  );
  return { world, authorize };
});
class Auth extends Context.Service<Auth, Effect.Success<typeof setup>>()('testing/Auth') {}

const op = (id: string, input: unknown) => Effect.flatMap(Auth, ({ world }) => world.op(id, input));
const table = Effect.map(op('list_accounts', {}), (answer) => (answer.body as { accounts: unknown[] }).accounts);
const signIns = Effect.map(
  op('read_sign_in', {}),
  (answer) =>
    (answer.body as { providers: Record<string, Array<{ account: string; default: boolean; origin: { kind: string } }>> }).providers,
);
const complete = op('complete_sign_in', { provider: SUBSCRIPTION_PROVIDER });
const consoleRows = (provider: string) =>
  Effect.map(table, (accounts) =>
    (accounts as { provider: string; account: string; default: boolean }[]).filter((row) => row.provider === provider),
  );

layer(Layer.effect(Auth, setup), { excludeTestServices: true })('auth HTTP door', (it) => {
  it.effect('the auth door completes a loopback sign-in through its owned listener', () =>
    Effect.gen(function* () {
      const { authorize } = yield* Auth;
      const absent = yield* complete;
      expect(absent.status).toBe(409);
      expect((absent.body as { code: string }).code).toBe('no-sign-in');
      const begun = yield* op('begin_sign_in', { provider: SUBSCRIPTION_PROVIDER });
      expect(begun.status).toBe(200);
      const challenge = (begun.body as { flow: { flow: string; authorizeUrl: string } }).flow;
      expect(challenge.flow).toBe('loopback');
      const waiting = yield* complete;
      expect(waiting.status).toBe(200);
      expect((waiting.body as { status: string }).status).toBe('pending');
      const offered = new URL(challenge.authorizeUrl);
      const fakeAuthorize = new URL(`http://127.0.0.1:${authorize.port}/authorize`);
      fakeAuthorize.searchParams.set('redirect_uri', offered.searchParams.get('redirect_uri') ?? '');
      fakeAuthorize.searchParams.set('state', offered.searchParams.get('state') ?? '');
      const redirected = yield* Effect.promise(() => fetch(fakeAuthorize, { redirect: 'follow' }));
      expect(redirected.status).toBe(200);
      const completed = yield* complete.pipe(
        Effect.filterOrFail(
          (answer) => (answer.body as { status: string }).status !== 'pending',
          () => new SignInPending({ message: 'the sign-in is still pending' }),
        ),
        Effect.retry({ schedule: Schedule.spaced('5 millis') }),
      );
      expect(completed.status).toBe(200);
      expect((completed.body as { account: unknown }).account).toMatchObject({
        provider: SUBSCRIPTION_PROVIDER,
        account: 'account-1',
        label: 'operator@example.com',
        organization: 'Example',
        origin: { kind: 'own' },
      });
      expect((yield* signIns)[SUBSCRIPTION_PROVIDER]).toHaveLength(1);
    }),
  );

  it.effect('a device grant the vendor ended answers a sign-in refusal', () =>
    Effect.gen(function* () {
      const begun = yield* op('begin_sign_in', { provider: DEVICE_PROVIDER });
      expect(begun.status).toBe(200);
      expect((begun.body as { flow: unknown }).flow).toMatchObject({ flow: 'device', userCode: 'WXYZ-1234' });
      const denied = yield* op('complete_sign_in', { provider: DEVICE_PROVIDER });
      expect(denied.status).toBe(409);
      expect(denied.body).toMatchObject({ code: 'sign-in-failed' });
    }),
  );

  it.effect('account status, relabel and remove carry the owner default', () =>
    Effect.gen(function* () {
      const { world } = yield* Auth;
      const expiresAt = (yield* Clock.currentTimeMillis) + 60_000;
      const first = yield* world.runtime.tokens.add(OPENAI_OAUTH_PROVIDER, {
        accessToken: 'first-access',
        refreshToken: 'first-refresh',
        expiresAt,
        accountId: 'first',
      });
      const second = yield* world.runtime.tokens.add(OPENAI_OAUTH_PROVIDER, {
        accessToken: 'second-access',
        refreshToken: 'second-refresh',
        expiresAt,
        accountId: 'second',
      });
      const defaults = Context.get(world.runtime.owners, DefaultAccounts);
      yield* defaults.saveDefaultAccount(OPENAI_OAUTH_PROVIDER, first);
      expect(yield* table).toEqual(expect.arrayContaining([expect.objectContaining({ account: first, default: true })]));
      expect((yield* signIns)[OPENAI_OAUTH_PROVIDER]).toEqual([
        expect.objectContaining({ account: first, default: true }),
        expect.objectContaining({ account: second, default: false }),
      ]);
      const relabelled = yield* op('rename_account', { provider: OPENAI_OAUTH_PROVIDER, account: second, label: 'Work' });
      expect(relabelled.status).toBe(200);
      expect((relabelled.body as { account: unknown }).account).toMatchObject({ account: second, label: 'Work', default: false });
      const removed = yield* op('remove_account', { provider: OPENAI_OAUTH_PROVIDER, account: first });
      expect(removed.status).toBe(200);
      expect((removed.body as { removed: unknown }).removed).toEqual({ provider: OPENAI_OAUTH_PROVIDER, removed: first, default: second });
      expect((yield* defaults.defaultAccount(OPENAI_OAUTH_PROVIDER)).account).toBe(second);
      expect((yield* signIns)[OPENAI_OAUTH_PROVIDER]).toEqual([expect.objectContaining({ account: second, default: true })]);
    }),
  );

  it.effect('the auth door stores console keys, and the account table is where they are read', () =>
    Effect.gen(function* () {
      expect(yield* consoleRows('muse')).toEqual([]);
      const empty = yield* op('save_console_key', { provider: 'muse', key: '  ' });
      expect(empty.status).toBe(409);
      expect((empty.body as { code: string }).code).toBe('empty-key');
      const saved = yield* op('save_console_key', { provider: 'muse', key: 'LLM-pasted' });
      expect(saved.status).toBe(200);
      const account = (saved.body as { key: { account: string } }).key.account;
      expect(account).toMatch(/^[0-9a-f]{12}$/);
      expect(JSON.stringify(saved.body)).not.toContain('LLM-pasted');
      const present = yield* consoleRows('muse');
      expect(present).toMatchObject([{ provider: 'muse', account, default: true }]);
      expect(JSON.stringify(present)).not.toContain('LLM-pasted');
      const removed = yield* op('remove_console_key', { provider: 'muse', account });
      expect(removed.status).toBe(200);
      expect((removed.body as { key: unknown }).key).toEqual({ provider: 'muse', account });
      expect(yield* consoleRows('muse')).toEqual([]);
    }),
  );

  it.effect('the auth door holds several keys of one provider, each under its own account', () =>
    Effect.gen(function* () {
      const first = yield* op('save_console_key', { provider: 'opencode-go', key: 'oc_sk_first' });
      const second = yield* op('save_console_key', { provider: 'opencode-go', key: 'oc_sk_second' });
      const firstAccount = (first.body as { key: { account: string } }).key.account;
      const secondAccount = (second.body as { key: { account: string } }).key.account;
      expect(firstAccount).not.toBe(secondAccount);
      const listed = yield* consoleRows('opencode-go');
      expect(listed.map((row) => row.account).toSorted()).toEqual([firstAccount, secondAccount].toSorted());
      expect(listed.filter((row) => row.default).map((row) => row.account)).toEqual([firstAccount]);
      const moved = yield* op('set_default_account', { provider: 'opencode-go', account: secondAccount });
      expect(moved.status).toBe(200);
      expect((yield* consoleRows('opencode-go')).filter((row) => row.default).map((row) => row.account)).toEqual([secondAccount]);
      yield* op('remove_console_key', { provider: 'opencode-go', account: firstAccount });
      expect((yield* consoleRows('opencode-go')).map((row) => row.account)).toEqual([secondAccount]);
    }),
  );
});
