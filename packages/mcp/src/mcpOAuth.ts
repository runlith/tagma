import type { AuthorizationServerMetadata, OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { Clock, Data, Duration, Effect } from 'effect';
import type { McpOAuthClient, McpOAuthServer, McpOAuthTokens } from './mcpGrant';

const OAUTH_TIMEOUT = Duration.seconds(30);

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const loadAuth = async () => {
  const [client, shared, utils, errors] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/auth.js'),
    import('@modelcontextprotocol/sdk/shared/auth.js'),
    import('@modelcontextprotocol/sdk/shared/auth-utils.js'),
    import('@modelcontextprotocol/sdk/server/auth/errors.js'),
  ]);
  return { client, shared, utils, OAuthError: errors.OAuthError };
};

type Loaded = Awaited<ReturnType<typeof loadAuth>>;

let loading: Promise<Loaded> | undefined;

export type McpOAuthStep = 'discovery' | 'registration' | 'authorization' | 'exchange' | 'refresh';

export type McpOAuthRefusal = 'invalid-grant' | 'invalid-client' | 'refused' | 'failed';

export class McpOAuthFailed extends Data.TaggedError('McpOAuthFailed')<{
  readonly step: McpOAuthStep;
  readonly kind: McpOAuthRefusal;
  readonly reason: string;
}> {
  override get message(): string {
    return `The OAuth ${this.step} failed: ${this.reason}`;
  }
}

export type McpOAuthChallenge = { readonly scope?: string; readonly resourceMetadata?: string };

const kindOf = (loaded: Loaded, error: unknown): McpOAuthRefusal => {
  if (!(error instanceof loaded.OAuthError)) return 'failed';
  switch (error.errorCode) {
    case 'invalid_grant':
      return 'invalid-grant';
    case 'invalid_client':
    case 'unauthorized_client':
      return 'invalid-client';
    case 'server_error':
    case 'temporarily_unavailable':
      return 'failed';
    default:
      return 'refused';
  }
};

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const asking = <A>(step: McpOAuthStep, request: (loaded: Loaded, signal: AbortSignal) => Promise<A>): Effect.Effect<A, McpOAuthFailed> =>
  Effect.flatMap(
    Effect.tryPromise({
      try: () =>
        (loading ??= loadAuth().catch((error: unknown) => {
          loading = undefined;
          throw error;
        })),
      catch: (error) => new McpOAuthFailed({ step, kind: 'failed', reason: `the MCP SDK could not load: ${reasonOf(error)}` }),
    }),
    (loaded) =>
      Effect.tryPromise({
        try: (signal) => request(loaded, signal),
        catch: (error) => new McpOAuthFailed({ step, kind: kindOf(loaded, error), reason: reasonOf(error) }),
      }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: OAUTH_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new McpOAuthFailed({ step, kind: 'failed', reason: `the server did not answer within ${Duration.format(OAUTH_TIMEOUT)}` }),
        ),
    }),
  );

const bounded =
  (fetcher: Fetch | undefined, signal: AbortSignal): Fetch =>
  (url, init) =>
    (fetcher ?? fetch)(url, { ...init, signal });

const metadataOf = (loaded: Loaded, server: McpOAuthServer): AuthorizationServerMetadata | undefined => {
  if (server.metadata === undefined) return undefined;
  const oauth = loaded.shared.OAuthMetadataSchema.safeParse(server.metadata);
  return oauth.success ? oauth.data : loaded.shared.OpenIdProviderDiscoveryMetadataSchema.parse(server.metadata);
};

const informationOf = (client: McpOAuthClient): OAuthClientInformationMixed => ({
  client_id: client.id,
  client_secret: client.secret,
  token_endpoint_auth_method: client.method,
});

const tokensOf = (tokens: OAuthTokens, now: number): McpOAuthTokens => ({
  access: tokens.access_token,
  refresh: tokens.refresh_token,
  expiresAt: tokens.expires_in === undefined ? undefined : now + tokens.expires_in * 1000,
  scope: tokens.scope,
});

const resourceOf = (server: McpOAuthServer) => (server.resource === undefined ? undefined : new URL(server.resource));

const flagged = (metadata: Readonly<Record<string, unknown>> | undefined, key: string): boolean => metadata?.[key] === true;

export const mcpOAuthDiscover = Effect.fn('mcp.oauth.discover')(
  (serverUrl: string, challenge: McpOAuthChallenge, fetcher?: Fetch): Effect.Effect<McpOAuthServer, McpOAuthFailed> =>
    asking('discovery', async (loaded, signal) => {
      const info = await loaded.client.discoverOAuthServerInfo(serverUrl, {
        resourceMetadataUrl: challenge.resourceMetadata === undefined ? undefined : new URL(challenge.resourceMetadata),
        fetchFn: bounded(fetcher, signal),
      });
      const declared = info.resourceMetadata?.resource;
      if (
        declared !== undefined &&
        !loaded.utils.checkResourceAllowed({
          requestedResource: loaded.utils.resourceUrlFromServerUrl(serverUrl),
          configuredResource: declared,
        })
      ) {
        throw new Error(`the protected resource ${declared} does not cover ${serverUrl}`);
      }
      const metadata = info.authorizationServerMetadata;
      const supported = info.resourceMetadata?.scopes_supported;
      return {
        url: info.authorizationServerUrl,
        issuer: metadata?.issuer,
        issuerInRedirect: flagged(metadata, 'authorization_response_iss_parameter_supported'),
        registers: metadata === undefined || metadata.registration_endpoint !== undefined,
        documents: metadata?.client_id_metadata_document_supported === true,
        metadata,
        resource: declared,
        scope: challenge.scope ?? (supported === undefined || supported.length === 0 ? undefined : supported.join(' ')),
      };
    }),
);

export const mcpOAuthRegister = Effect.fn('mcp.oauth.register')(
  (
    server: McpOAuthServer,
    input: { readonly name: string; readonly redirects: readonly string[] },
    fetcher?: Fetch,
  ): Effect.Effect<McpOAuthClient, McpOAuthFailed> =>
    asking('registration', async (loaded, signal) => {
      const registered = await loaded.client.registerClient(server.url, {
        metadata: metadataOf(loaded, server),
        clientMetadata: {
          client_name: input.name,
          redirect_uris: [...input.redirects],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
        scope: server.scope,
        fetchFn: bounded(fetcher, signal),
      });
      return {
        kind: 'registered' as const,
        id: registered.client_id,
        secret: registered.client_secret,
        method: registered.token_endpoint_auth_method,
        redirects: input.redirects,
      };
    }),
);

export const mcpOAuthAuthorization = Effect.fn('mcp.oauth.authorization')(
  (
    server: McpOAuthServer,
    client: McpOAuthClient,
    input: { readonly redirect: string; readonly state: string },
  ): Effect.Effect<{ readonly url: string; readonly verifier: string }, McpOAuthFailed> =>
    asking('authorization', async (loaded) => {
      const started = await loaded.client.startAuthorization(server.url, {
        metadata: metadataOf(loaded, server),
        clientInformation: informationOf(client),
        redirectUrl: input.redirect,
        scope: server.scope,
        state: input.state,
        resource: resourceOf(server),
      });
      return { url: started.authorizationUrl.href, verifier: started.codeVerifier };
    }),
);

export const mcpOAuthExchange = Effect.fn('mcp.oauth.exchange')(function* (
  server: McpOAuthServer,
  client: McpOAuthClient,
  input: { readonly code: string; readonly verifier: string; readonly redirect: string },
  fetcher?: Fetch,
) {
  const tokens = yield* asking('exchange', (loaded, signal) =>
    loaded.client.exchangeAuthorization(server.url, {
      metadata: metadataOf(loaded, server),
      clientInformation: informationOf(client),
      authorizationCode: input.code,
      codeVerifier: input.verifier,
      redirectUri: input.redirect,
      resource: resourceOf(server),
      fetchFn: bounded(fetcher, signal),
    }),
  );
  return tokensOf(tokens, yield* Clock.currentTimeMillis);
});

export const mcpOAuthRefresh = Effect.fn('mcp.oauth.refresh')(function* (
  server: McpOAuthServer,
  client: McpOAuthClient,
  refresh: string,
  fetcher?: Fetch,
) {
  const tokens = yield* asking('refresh', (loaded, signal) =>
    loaded.client.refreshAuthorization(server.url, {
      metadata: metadataOf(loaded, server),
      clientInformation: informationOf(client),
      refreshToken: refresh,
      resource: resourceOf(server),
      fetchFn: bounded(fetcher, signal),
    }),
  );
  return tokensOf(tokens, yield* Clock.currentTimeMillis);
});

export type McpOAuthIssuer = 'accepted' | 'mismatched' | 'missing';

export const mcpOAuthIssuer = (server: McpOAuthServer, iss: string | null): McpOAuthIssuer => {
  if (iss === null) return server.issuerInRedirect ? 'missing' : 'accepted';
  return iss === server.issuer ? 'accepted' : 'mismatched';
};
