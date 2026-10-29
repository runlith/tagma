import type { AuthorizationServerMetadata, OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { Clock, Data, Duration, Effect, Schema } from 'effect';
import type { McpOAuthClient, McpOAuthServer, McpOAuthTokens } from './mcpGrant';

const OAUTH_TIMEOUT = Duration.seconds(30);

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const loadAuth = async () => {
  const [client, shared, utils, errors, types] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/auth.js'),
    import('@modelcontextprotocol/sdk/shared/auth.js'),
    import('@modelcontextprotocol/sdk/shared/auth-utils.js'),
    import('@modelcontextprotocol/sdk/server/auth/errors.js'),
    import('@modelcontextprotocol/sdk/types.js'),
  ]);
  return { client, shared, utils, OAuthError: errors.OAuthError, protocol: types.LATEST_PROTOCOL_VERSION };
};

type Loaded = Awaited<ReturnType<typeof loadAuth>>;

let loading: Promise<Loaded> | undefined;

export type McpOAuthStep = 'discovery' | 'document' | 'registration' | 'authorization' | 'exchange' | 'refresh';

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

const formsOf = (secret: string): readonly string[] => [
  secret,
  encodeURIComponent(secret),
  new URLSearchParams({ x: secret }).toString().slice(2),
  JSON.stringify(secret).slice(1, -1),
];

const scrubbed = (reason: string, sent: readonly (string | undefined)[]): string =>
  sent
    .flatMap((secret) => (secret === undefined || secret === '' ? [] : formsOf(secret)))
    .sort((left, right) => right.length - left.length)
    .reduce((said, form) => said.replaceAll(form, '[redacted]'), reason);

const asking = <A>(
  step: McpOAuthStep,
  sent: readonly (string | undefined)[],
  request: (loaded: Loaded, signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, McpOAuthFailed> =>
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
        catch: (error) => new McpOAuthFailed({ step, kind: kindOf(loaded, error), reason: scrubbed(reasonOf(error), sent) }),
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

const protectedResource = async (loaded: Loaded, serverUrl: string, challenge: McpOAuthChallenge, fetchFn: Fetch) => {
  try {
    return await loaded.client.discoverOAuthProtectedResourceMetadata(
      serverUrl,
      { resourceMetadataUrl: challenge.resourceMetadata === undefined ? undefined : new URL(challenge.resourceMetadata) },
      fetchFn,
    );
  } catch {
    return undefined;
  }
};

const serverMetadata = async (loaded: Loaded, url: string, fetchFn: Fetch): Promise<Readonly<Record<string, unknown>> | undefined> => {
  for (const { url: endpoint, type } of loaded.client.buildDiscoveryUrls(url)) {
    const response = await fetchFn(endpoint, { headers: { 'MCP-Protocol-Version': loaded.protocol, Accept: 'application/json' } });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 400 && response.status < 500) continue;
      throw new Error(`HTTP ${response.status} trying to load ${type === 'oauth' ? 'OAuth' : 'OpenID provider'} metadata from ${endpoint}`);
    }
    const raw: unknown = await response.json();
    (type === 'oauth' ? loaded.shared.OAuthMetadataSchema : loaded.shared.OpenIdProviderDiscoveryMetadataSchema).parse(raw);
    return raw as Readonly<Record<string, unknown>>;
  }
  return undefined;
};

export const mcpOAuthDiscover = Effect.fn('mcp.oauth.discover')(
  (serverUrl: string, challenge: McpOAuthChallenge, fetcher?: Fetch): Effect.Effect<McpOAuthServer, McpOAuthFailed> =>
    asking('discovery', [], async (loaded, signal) => {
      const fetchFn = bounded(fetcher, signal);
      const resourceMetadata = await protectedResource(loaded, serverUrl, challenge, fetchFn);
      const declared = resourceMetadata?.resource;
      if (
        declared !== undefined &&
        !loaded.utils.checkResourceAllowed({
          requestedResource: loaded.utils.resourceUrlFromServerUrl(serverUrl),
          configuredResource: declared,
        })
      ) {
        throw new Error(`the protected resource ${declared} does not cover ${serverUrl}`);
      }
      const url = resourceMetadata?.authorization_servers?.[0] ?? String(new URL('/', serverUrl));
      const metadata = await serverMetadata(loaded, url, fetchFn);
      const supported = resourceMetadata?.scopes_supported;
      return {
        url,
        issuer: typeof metadata?.issuer === 'string' ? metadata.issuer : undefined,
        issuerInRedirect: flagged(metadata, 'authorization_response_iss_parameter_supported'),
        registers: metadata === undefined || typeof metadata.registration_endpoint === 'string',
        documents: flagged(metadata, 'client_id_metadata_document_supported'),
        metadata,
        resource: declared,
        scope: challenge.scope ?? (supported === undefined || supported.length === 0 ? undefined : supported.join(' ')),
      };
    }),
);

const ClientDocument = Schema.Struct({ client_id: Schema.String, redirect_uris: Schema.Array(Schema.String) });

const decodeClientDocument = Schema.decodeUnknownEffect(ClientDocument);

export const mcpOAuthDocument = Effect.fn('mcp.oauth.document')(function* (
  document: string,
  redirect: string,
  fetcher?: Fetch,
): Effect.fn.Return<void, McpOAuthFailed> {
  const skipped = (reason: string) => new McpOAuthFailed({ step: 'document', kind: 'failed', reason });
  const raw = yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await bounded(fetcher, signal)(document, { headers: { Accept: 'application/json' }, redirect: 'manual' });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const body: unknown = await response.json();
      return body;
    },
    catch: (error) => skipped(`${document} could not be read: ${reasonOf(error)}`),
  }).pipe(
    Effect.timeoutOrElse({
      duration: OAUTH_TIMEOUT,
      orElse: () => Effect.fail(skipped(`${document} did not answer within ${Duration.format(OAUTH_TIMEOUT)}`)),
    }),
  );
  const listed = yield* decodeClientDocument(raw).pipe(
    Effect.mapError(() => skipped(`${document} is not a client metadata document naming its redirect addresses`)),
  );
  if (listed.client_id !== document) return yield* skipped(`${document} names ${listed.client_id} as its client id, not its own address`);
  if (!listed.redirect_uris.includes(redirect)) return yield* skipped(`${document} does not list ${redirect}`);
});

export const mcpOAuthRegister = Effect.fn('mcp.oauth.register')(
  (
    server: McpOAuthServer,
    input: { readonly name: string; readonly redirects: readonly string[] },
    fetcher?: Fetch,
  ): Effect.Effect<McpOAuthClient, McpOAuthFailed> =>
    asking('registration', [], async (loaded, signal) => {
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
    asking('authorization', [client.secret], async (loaded) => {
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
  const tokens = yield* asking('exchange', [client.secret, input.code, input.verifier], (loaded, signal) =>
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
  const tokens = yield* asking('refresh', [client.secret, refresh], (loaded, signal) =>
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
