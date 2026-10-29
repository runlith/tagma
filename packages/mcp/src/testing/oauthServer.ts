import { createHash } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Effect } from 'effect';

type Client = { readonly redirects: readonly string[] };
type Code = { readonly client: string; readonly challenge: string; readonly redirect: string };

export type OAuthServer = {
  readonly url: string;
  readonly issuer: string;
  readonly follow: (authorization: string) => Effect.Effect<URL>;
  readonly expire: (held: number) => void;
  readonly shortLived: (grants: number) => void;
  readonly refreshes: () => number;
  readonly rejections: () => number;
  readonly sessions: () => number;
};

export type OAuthDiscovery = 'oauth' | 'oidc';

const STEP_UP = 'Bearer error="insufficient_scope", scope="tools admin"';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const refused = (error: string, status = 400) => json({ error }, status);

const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

const answering = async (request: Request, authorization: string) => {
  const server = new Server({ name: 'guarded', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'whoami', description: 'Answers the authorization the call carried.', inputSchema: { type: 'object' as const } },
      { name: 'escalate', description: 'Asks for a scope the sign-in did not grant.', inputSchema: { type: 'object' as const } },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text' as const, text: authorization }] }));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
};

export const oauthServer = (discovery: OAuthDiscovery = 'oauth') =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const clients = new Map<string, Client>();
      const codes = new Map<string, Code>();
      const access = new Set<string>();
      const refreshing = new Map<string, string>();
      const expired = new Set<string>();
      const parked: Array<() => void> = [];
      let held = 0;
      let short = 0;
      let issued = 0;
      let refreshes = 0;
      let rejections = 0;
      let sessions = 0;
      let origin = '';

      const metadata = () => ({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        authorization_response_iss_parameter_supported: true,
        ...(discovery === 'oidc'
          ? { jwks_uri: `${origin}/jwks`, subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] }
          : {}),
      });

      const grant = (client: string) => {
        issued += 1;
        const token = `access-${issued}`;
        const refresh = `refresh-${issued}`;
        access.add(token);
        refreshing.set(refresh, client);
        const lifetime = short > 0 ? 30 : 3600;
        short = Math.max(0, short - 1);
        return json({ access_token: token, token_type: 'Bearer', expires_in: lifetime, refresh_token: refresh, scope: 'tools' });
      };

      const resource = async (request: Request) => {
        const authorization = request.headers.get('authorization') ?? '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        if (expired.has(token) && held > 0) {
          await new Promise<void>((release) => {
            parked.push(release);
            if (parked.length >= held) {
              held = 0;
              for (const waiting of parked.splice(0)) waiting();
            }
          });
        }
        if (!access.has(token) || expired.has(token)) {
          rejections += 1;
          return new Response('', {
            status: 401,
            headers: { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="tools"` },
          });
        }
        const body = request.method === 'POST' ? await request.clone().text() : '';
        if (body.includes('"method":"initialize"')) sessions += 1;
        if (body.includes('"method":"tools/call"') && body.includes('"name":"escalate"')) {
          return new Response('', { status: 403, headers: { 'www-authenticate': STEP_UP } });
        }
        return answering(request, authorization);
      };

      const token = async (request: Request) => {
        const form = new URLSearchParams(await request.text());
        if (form.get('grant_type') === 'refresh_token') {
          const presented = form.get('refresh_token') ?? '';
          const client = refreshing.get(presented);
          if (client === undefined || client !== form.get('client_id')) return refused('invalid_grant');
          refreshing.delete(presented);
          refreshes += 1;
          return grant(client);
        }
        const code = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        if (code === undefined || code.client !== form.get('client_id') || code.redirect !== form.get('redirect_uri')) {
          return refused('invalid_grant');
        }
        if (challengeOf(form.get('code_verifier') ?? '') !== code.challenge) return refused('invalid_grant');
        return grant(code.client);
      };

      const authorize = (url: URL) => {
        const client = url.searchParams.get('client_id') ?? '';
        const redirect = url.searchParams.get('redirect_uri') ?? '';
        if (!(clients.get(client)?.redirects.includes(redirect) ?? false)) return refused('invalid_request');
        const code = `code-${codes.size + issued + 1}-${crypto.randomUUID()}`;
        codes.set(code, { client, challenge: url.searchParams.get('code_challenge') ?? '', redirect });
        const back = new URL(redirect);
        back.searchParams.set('code', code);
        back.searchParams.set('state', url.searchParams.get('state') ?? '');
        back.searchParams.set('iss', origin);
        return new Response(null, { status: 302, headers: { location: back.href } });
      };

      const register = async (request: Request) => {
        const body = (await request.json()) as { readonly redirect_uris?: readonly string[] };
        const id = `client-${clients.size + 1}`;
        clients.set(id, { redirects: body.redirect_uris ?? [] });
        return json({ ...body, client_id: id, token_endpoint_auth_method: 'none' }, 201);
      };

      const served = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: (request) => {
          const url = new URL(request.url);
          switch (url.pathname) {
            case '/mcp':
              return resource(request);
            case '/.well-known/oauth-protected-resource/mcp':
              return json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['tools'] });
            case '/.well-known/oauth-authorization-server':
              return discovery === 'oauth' ? json(metadata()) : new Response('', { status: 404 });
            case '/.well-known/openid-configuration':
              return discovery === 'oidc' ? json(metadata()) : new Response('', { status: 404 });
            case '/register':
              return register(request);
            case '/authorize':
              return authorize(url);
            case '/token':
              return token(request);
            default:
              return new Response('', { status: 404 });
          }
        },
      });
      origin = `http://127.0.0.1:${served.port}`;
      const server: OAuthServer = {
        url: `${origin}/mcp`,
        issuer: origin,
        follow: (authorization) =>
          Effect.promise(async () => {
            const answered = await fetch(authorization, { redirect: 'manual' });
            return new URL(answered.headers.get('location') ?? `${origin}/no-redirect?status=${answered.status}`);
          }),
        expire: (holding) => {
          for (const token of access) expired.add(token);
          held = holding;
        },
        shortLived: (grants) => {
          short = grants;
        },
        refreshes: () => refreshes,
        rejections: () => rejections,
        sessions: () => sessions,
      };
      return { served, server };
    }),
    ({ served }) => Effect.promise(() => served.stop(true)),
  ).pipe(Effect.map(({ server }) => server));
