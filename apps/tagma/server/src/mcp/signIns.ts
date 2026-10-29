import { MCP_NEEDS_SIGN_IN, type McpAuth, McpAuthUnavailable } from '@runlith/mcp/McpAuth';
import type { McpOAuthClient, McpOAuthServer, McpOAuthTokens } from '@runlith/mcp/grant';
import {
  type McpOAuthChallenge,
  mcpOAuthAuthorization,
  mcpOAuthDiscover,
  mcpOAuthExchange,
  mcpOAuthIssuer,
  mcpOAuthRefresh,
  mcpOAuthRegister,
} from '@runlith/mcp/auth';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import type { McpServerStatus } from '@runlith/mcp/McpPool';
import { Clock, Data, Duration, Effect, FiberMap } from 'effect';
import * as Base64Url from 'effect/encoding/Base64Url';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import {
  type McpOwnClient,
  type McpSignedIn,
  type McpSignInAnswer,
  McpSignInRejected,
  type McpSignInRejection,
} from './contract/service/servers.js';
import { mcpClientDocument } from './contract/wire/settings.js';
import { kept, recordOf, type SignInRecord, type SignInUnreadable } from './record.js';

const KIND = 'mcp';
const PENDING_MS = 10 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;
const CLIENT_NAME = 'Tagma';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

type Pending = {
  readonly key: string;
  readonly name: string;
  readonly redirect: string;
  readonly verifier: string;
  readonly server: McpOAuthServer;
  readonly client: McpOAuthClient;
  readonly expiresAt: number;
  readonly lifetime: number;
};

type Grant = {
  readonly client: McpOAuthClient;
  readonly server: McpOAuthServer;
  readonly tokens: McpOAuthTokens;
};

export type SignInStart = {
  readonly key: string;
  readonly name: string;
  readonly projectId: number;
  readonly url: string;
  readonly redirect: string;
  readonly challenge: McpOAuthChallenge;
  readonly client?: McpOwnClient;
};

class SignedOut extends Data.TaggedError('SignedOut') {}

class SignInEnded extends Data.TaggedError('SignInEnded') {}

class RefreshRefused extends Data.TaggedError('RefreshRefused')<{ readonly identity: string; readonly client: boolean }> {}

const identityOf = (tokens: McpOAuthTokens): string => tokens.refresh ?? tokens.access;

const expiring = (tokens: McpOAuthTokens, now: number): boolean =>
  tokens.expiresAt !== undefined && tokens.expiresAt - now <= EXPIRY_MARGIN_MS;

const loopback = (redirect: string): boolean => {
  const url = new URL(redirect);
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname);
};

const storeRefusal = () =>
  new GateRefusal('secret-store-failed', 'The secret store could not be read or written, so the sign-in it keeps is out of reach.', [
    'make the file secrets.json in the server’s data directory readable and writable to the server, then repeat',
  ]);

const failedRefusal = (failure: { readonly message: string }) =>
  new GateRefusal('mcp-sign-in-failed', failure.message, [
    'read_mcp_servers names the server and its state',
    'sign in again once the service answers',
  ]);

const rejected = (rejection: McpSignInRejection, reason: string, server?: string) => new McpSignInRejected({ rejection, reason, server });

const unavailable = (failure: { readonly message: string }) => new McpAuthUnavailable({ reason: failure.message });

export const makeSignIns = Effect.fnUntraced(function* (input: {
  readonly reconnect: (key: string) => Effect.Effect<readonly McpServerStatus[], HoldStalled | HoldCut>;
  readonly moved: (key: string) => Effect.Effect<void>;
}) {
  const owners = yield* SecretOwners;
  const settings = yield* Settings;
  const pendings = new Map<string, Pending>();
  const lifetimes = new Map<string, number>();
  const expiries = yield* FiberMap.make<string>();

  const lifetimeOf = (key: string): number => lifetimes.get(key) ?? 0;

  const withdrawn = (key: string): boolean => {
    let left = false;
    for (const [state, held] of pendings) {
      if (held.key !== key) continue;
      pendings.delete(state);
      left = true;
    }
    return left;
  };

  const ended = Effect.fnUntraced(function* (key: string) {
    lifetimes.set(key, lifetimeOf(key) + 1);
    yield* FiberMap.remove(expiries, key);
    if (withdrawn(key)) yield* input.moved(key);
  });

  const expired = (state: string, key: string) => Effect.suspend(() => (pendings.delete(state) ? input.moved(key) : Effect.void));

  const stored = (key: string) => Effect.flatMap(owners.handout(KIND), (given) => recordOf(key, given(key).signIn));

  const identity = Effect.fnUntraced(function* (record: SignInRecord, server: McpOAuthServer, start: SignInStart) {
    const standing = record.client;
    if (standing?.kind === 'pre-registered') return standing;
    if (standing !== undefined && record.server?.url === server.url && standing.redirects.includes(start.redirect)) return standing;
    const document = yield* settings.value(mcpClientDocument, start.projectId).pipe(Effect.mapError(storeRefusal));
    if (server.documents && document !== null && loopback(start.redirect)) {
      return { kind: 'document' as const, id: document, redirects: [start.redirect] };
    }
    if (server.registers) {
      const covered = standing?.kind === 'registered' && record.server?.url === server.url ? standing.redirects : [];
      return yield* mcpOAuthRegister(server, { name: CLIENT_NAME, redirects: [...new Set([...covered, start.redirect])] }).pipe(
        Effect.mapError(failedRefusal),
      );
    }
    return yield* new GateRefusal(
      'mcp-sign-in-unsupported',
      `The authorization server of ${start.name} accepts neither a client metadata document nor dynamic registration, and no client is registered for it.`,
      [`register a client with the service for ${start.redirect} and sign in with its client id`],
    );
  });

  const begin = Effect.fn('McpSignIns.begin')(function* (start: SignInStart) {
    const own: McpOAuthClient | undefined =
      start.client === undefined ? undefined : { kind: 'pre-registered', id: start.client.id, secret: start.client.secret, redirects: [] };
    if (own !== undefined) {
      yield* owners
        .keepSignIn(KIND, start.key, (signIn) => Effect.map(recordOf(start.key, signIn), (record) => ({ ...record, client: own })))
        .pipe(Effect.mapError(storeRefusal));
    }
    const record = yield* stored(start.key).pipe(Effect.mapError(storeRefusal));
    const server = yield* mcpOAuthDiscover(start.url, start.challenge).pipe(Effect.mapError(failedRefusal));
    const client = own ?? (yield* identity(record, server, start));
    const state = Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)));
    const opened = yield* mcpOAuthAuthorization(server, client, { redirect: start.redirect, state }).pipe(Effect.mapError(failedRefusal));
    const now = yield* Clock.currentTimeMillis;
    withdrawn(start.key);
    pendings.set(state, {
      key: start.key,
      name: start.name,
      redirect: start.redirect,
      verifier: opened.verifier,
      server,
      client,
      expiresAt: now + PENDING_MS,
      lifetime: lifetimeOf(start.key),
    });
    yield* FiberMap.run(expiries, start.key, Effect.andThen(Effect.sleep(Duration.millis(PENDING_MS)), expired(state, start.key)));
    yield* input.moved(start.key);
    return { url: opened.url };
  });

  const finish = Effect.fn('McpSignIns.finish')(function* (answer: McpSignInAnswer): Effect.fn.Return<McpSignedIn, McpSignInRejected> {
    const now = yield* Clock.currentTimeMillis;
    const pending = answer.state === null ? undefined : pendings.get(answer.state);
    if (pending !== undefined && answer.state !== null) {
      pendings.delete(answer.state);
      yield* FiberMap.remove(expiries, pending.key);
      yield* input.moved(pending.key);
    }
    if (pending === undefined || pending.expiresAt <= now) {
      return yield* rejected('unknown', 'This sign-in is not one Tagma started, or it was already used or has expired.');
    }
    const issuer = mcpOAuthIssuer(pending.server, answer.iss);
    if (issuer === 'mismatched') {
      return yield* rejected('forged', 'The answer names an authorization server other than the one this sign-in went to.', pending.name);
    }
    if (issuer === 'missing') {
      return yield* rejected(
        'forged',
        'The answer names no authorization server, though the one this sign-in went to promises to name itself.',
        pending.name,
      );
    }
    if (answer.error !== null) {
      const told = answer.description === null ? answer.error : `${answer.error}: ${answer.description}`;
      return yield* rejected('refused', `The service refused the sign-in (${told}).`, pending.name);
    }
    if (answer.code === null) return yield* rejected('refused', 'The answer carries no authorization code.', pending.name);
    const tokens = yield* mcpOAuthExchange(pending.server, pending.client, {
      code: answer.code,
      verifier: pending.verifier,
      redirect: pending.redirect,
    }).pipe(Effect.mapError((failure) => rejected('failed', failure.message, pending.name)));
    yield* owners
      .keepSignIn<SignInEnded | SignInUnreadable>(KIND, pending.key, (signIn) =>
        lifetimeOf(pending.key) === pending.lifetime
          ? Effect.map(recordOf(pending.key, signIn), (record) => ({ ...record, client: pending.client, server: pending.server, tokens }))
          : Effect.fail(new SignInEnded()),
      )
      .pipe(
        Effect.mapError((failure) =>
          failure._tag === 'SignInEnded'
            ? rejected('unknown', 'The server was removed or signed out while this sign-in finished, so nothing is kept.', pending.name)
            : rejected('failed', 'The tokens could not be kept: the secret store could not be written.', pending.name),
        ),
      );
    yield* input.moved(pending.key);
    const statuses = yield* input
      .reconnect(pending.key)
      .pipe(Effect.mapError((held) => rejected('failed', `Signed in, but the server did not reconnect: ${held.message}`, pending.name)));
    return { server: pending.name, connected: statuses.length === 0 ? null : statuses.includes('connected') };
  });

  const signOut = Effect.fn('McpSignIns.signOut')(function* (key: string) {
    yield* ended(key);
    yield* owners
      .keepSignIn(KIND, key, (signIn) => Effect.map(recordOf(key, signIn), (record) => kept({ ...record, tokens: undefined })))
      .pipe(Effect.mapError(storeRefusal));
    yield* input
      .reconnect(key)
      .pipe(
        Effect.mapError(
          (held) =>
            new GateRefusal('mcp-reconcile-stalled', `The tokens are dropped, but the server did not reconnect: ${held.message}`, [
              'enable_mcp_server on the server connects it again',
            ]),
        ),
      );
  });

  const pending = (key: string, now: number): boolean => [...pendings.values()].some((held) => held.key === key && held.expiresAt > now);

  const grantOf = (record: SignInRecord): Effect.Effect<Grant, SignedOut> =>
    record.client === undefined || record.server === undefined || record.tokens === undefined
      ? Effect.fail(new SignedOut())
      : Effect.succeed({ client: record.client, server: record.server, tokens: record.tokens });

  const forgotten = (key: string, refused: RefreshRefused) =>
    owners.keepSignIn(KIND, key, (signIn) =>
      Effect.map(recordOf(key, signIn), (record) =>
        record.tokens === undefined || identityOf(record.tokens) !== refused.identity
          ? record
          : kept({
              ...record,
              tokens: undefined,
              client: refused.client && record.client?.kind !== 'pre-registered' ? undefined : record.client,
            }),
      ),
    );

  const refreshed = (key: string, needed: (grant: Grant, now: number) => boolean): Effect.Effect<void, McpAuthUnavailable> =>
    owners
      .refreshSignIn<Grant, SignInUnreadable | SignedOut | RefreshRefused | McpAuthUnavailable, never>(KIND, key, {
        grant: (signIn) => Effect.flatMap(recordOf(key, signIn), grantOf),
        identity: (grant) => identityOf(grant.tokens),
        needed: (grant) => Effect.map(Clock.currentTimeMillis, (now) => needed(grant, now)),
        refresh: (grant) =>
          grant.tokens.refresh === undefined
            ? Effect.fail(new RefreshRefused({ identity: grant.tokens.access, client: false }))
            : mcpOAuthRefresh(grant.server, grant.client, grant.tokens.refresh).pipe(
                Effect.map((tokens): Grant => ({ ...grant, tokens })),
                Effect.mapError((failure) =>
                  failure.kind === 'failed'
                    ? unavailable(failure)
                    : new RefreshRefused({ identity: identityOf(grant.tokens), client: failure.kind === 'invalid-client' }),
                ),
              ),
        replace: (signIn, grant) => Effect.map(recordOf(key, signIn), (record) => ({ ...record, tokens: grant.tokens })),
      })
      .pipe(
        Effect.catchTags({
          SignedOut: () => Effect.void,
          RefreshRefused: (refused) => forgotten(key, refused),
        }),
        Effect.mapError((failure) => (failure._tag === 'McpAuthUnavailable' ? failure : unavailable(failure))),
      );

  const auth = (key: string, mask: (token: string) => void): McpAuth => {
    const offered = <T extends string | undefined>(token: T): Effect.Effect<T> =>
      Effect.sync(() => {
        if (token !== undefined) mask(token);
        return token;
      });
    const read = () => stored(key).pipe(Effect.mapError(unavailable));
    return {
      bearer: Effect.fn('McpSignIns.bearer')(function* () {
        const tokens = (yield* read()).tokens;
        if (tokens === undefined) return undefined;
        if (tokens.refresh === undefined || !expiring(tokens, yield* Clock.currentTimeMillis)) return yield* offered(tokens.access);
        yield* refreshed(key, (grant, now) => expiring(grant.tokens, now));
        return yield* offered((yield* read()).tokens?.access);
      }),
      rejected: Effect.fn('McpSignIns.rejected')(function* (token: string) {
        yield* refreshed(key, (grant) => grant.tokens.access === token);
        const fresh = (yield* read()).tokens?.access;
        return fresh === undefined || fresh === token ? MCP_NEEDS_SIGN_IN : yield* offered(fresh);
      }),
    };
  };

  return { begin, finish, signOut, forget: ended, pending, auth, stored };
});

export type SignIns = Effect.Success<ReturnType<typeof makeSignIns>>;
