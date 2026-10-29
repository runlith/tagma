import { escapeHtml } from '@runlith/utils/text';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { McpServers } from './contract/service/servers.js';
import { MCP_CALLBACK_PATH } from './contract/wire/callback.js';

const page = (title: string, said: string, status: number) =>
  HttpServerResponse.text(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body style="font:15px system-ui;padding:2rem;max-width:36rem"><h1 style="font-size:18px">${escapeHtml(title)}</h1><p>${escapeHtml(said)}</p>`,
    { status, contentType: 'text/html; charset=utf-8' },
  ).pipe(
    HttpServerResponse.setHeaders({
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'referrer-policy': 'no-referrer',
    }),
  );

const answered = (servers: McpServers['Service']) => (request: HttpServerRequest.HttpServerRequest) => {
  const query = new URL(request.url, 'http://localhost').searchParams;
  return servers
    .finishSignIn({
      state: query.get('state'),
      code: query.get('code'),
      iss: query.get('iss'),
      error: query.get('error'),
      description: query.get('error_description'),
    })
    .pipe(
      Effect.match({
        onSuccess: ({ server }) =>
          page(`Signed in to ${server}`, 'Tagma keeps the sign-in and has connected the server. You can close this tab.', 200),
        onFailure: (refused) =>
          page(refused.server === undefined ? 'Sign-in refused' : `Sign-in to ${refused.server} refused`, refused.reason, 400),
      }),
    );
};

export const mcpCallbackRoute = Layer.unwrap(
  Effect.gen(function* () {
    return HttpRouter.add('GET', MCP_CALLBACK_PATH, answered(yield* McpServers));
  }),
);
