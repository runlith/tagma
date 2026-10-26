import { Data, Deferred, Duration, Effect } from 'effect';
import { OAuthFlowFailed } from './flows/vendorPayload';

class CallbackServerStopFailed extends Data.TaggedError('CallbackServerStopFailed')<{
  readonly cause: unknown;
}> {}

const HTML_SUCCESS = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Login complete</title></head>
<body style="font-family: system-ui; padding: 2rem; text-align: center;">
  <h1>You can close this window.</h1>
  <p>Login complete. Return to the application.</p>
</body>
</html>`;

const HTML_ERROR = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Login failed</title></head>
<body style="font-family: system-ui; padding: 2rem; text-align: center;">
  <h1>Login failed.</h1>
  <p>You can close this window and try again.</p>
</body>
</html>`;

export type CallbackResult = {
  code: string;
  state: string;
  redirectUri: string;
};

export type CallbackOptions = {
  path: string;
  port?: number;
  host?: string;
  redirectHost?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export type CallbackServer = {
  redirectUri: string;
  port: number;
  result: Effect.Effect<CallbackResult, OAuthFlowFailed>;
};

export const callbackServer = Effect.fn('CallbackServer.open')(function* (options: CallbackOptions) {
  const host = options.host ?? '127.0.0.1';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deferred = Deferred.makeUnsafe<CallbackResult, OAuthFlowFailed>();
  const settle = (result: CallbackResult) => Deferred.doneUnsafe(deferred, Effect.succeed(result));
  const refuse = (reason: string) => Deferred.doneUnsafe(deferred, Effect.fail(new OAuthFlowFailed({ reason })));
  let resolvedRedirect = '';

  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: host,
        port: options.port ?? 0,
        fetch(request) {
          const url = new URL(request.url);
          if (url.pathname !== options.path) {
            return new Response('Not found', { status: 404 });
          }
          const error = url.searchParams.get('error');
          if (error) {
            const description = url.searchParams.get('error_description') ?? '';
            refuse(`OAuth error: ${error}${description ? ` (${description})` : ''}`);
            return new Response(HTML_ERROR, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
          }
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          if (!code || !state) {
            refuse('OAuth callback missing code or state');
            return new Response(HTML_ERROR, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
          }
          settle({ code, state, redirectUri: resolvedRedirect });
          return new Response(HTML_SUCCESS, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        },
      }),
    ),
    (listening) =>
      Effect.tryPromise({
        try: () => listening.stop(),
        catch: (cause) => new CallbackServerStopFailed({ cause }),
      }).pipe(Effect.catch(() => Effect.succeed(undefined))),
  );

  const actualPort = server.port;
  if (typeof actualPort !== 'number') {
    return yield* new OAuthFlowFailed({ reason: 'Failed to determine OAuth callback port' });
  }
  const redirectUri = `http://${options.redirectHost ?? 'localhost'}:${actualPort}${options.path}`;
  resolvedRedirect = redirectUri;

  yield* Effect.forkScoped(
    Effect.sleep(Duration.millis(timeoutMs)).pipe(Effect.andThen(Effect.sync(() => refuse('OAuth login timed out')))),
  );

  const signal = options.signal;
  if (signal) {
    const abort = () => refuse('OAuth login aborted');
    if (signal.aborted) abort();
    else {
      signal.addEventListener('abort', abort, { once: true });
      yield* Effect.addFinalizer(() => Effect.sync(() => signal.removeEventListener('abort', abort)));
    }
  }

  return { redirectUri, port: actualPort, result: Deferred.await(deferred) } satisfies CallbackServer;
});
