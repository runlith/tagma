import { Clock, Effect } from 'effect';
import { HttpServerRequest, HttpServerResponse, HttpStaticServer } from 'effect/http';
import type { RestartRecords } from '../installation/contract/service/restarts.js';
import { handoverOf } from '../installation/process/record.js';
import { OUTCOME_HEADER } from '../invocation/contract/wire/headers.js';
import { API_PREFIX } from './contract/wire/served.js';

export const startingHandler = Effect.fnUntraced(function* (records: RestartRecords['Service'], appDist: string) {
  const surface = yield* HttpStaticServer.make({ root: appDist, spa: true, cacheControl: 'no-cache' });
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = new URL(request.url, 'http://localhost').pathname;
    const state = yield* records.state;
    const { startup, issue } = state;
    const headers = { 'cache-control': 'no-store' };
    if (request.method === 'GET' && path === '/startup')
      return HttpServerResponse.jsonUnsafe({ startup, issue, restart: handoverOf(state, yield* Clock.currentTimeMillis) }, { headers });
    if ((request.method === 'GET' || request.method === 'HEAD') && path === '/health')
      return HttpServerResponse.jsonUnsafe(
        { ok: false, startup, issue, restart: handoverOf(state, yield* Clock.currentTimeMillis) },
        { status: 503, headers },
      );
    if ((request.method === 'GET' || request.method === 'HEAD') && !path.startsWith(API_PREFIX) && request.headers.upgrade === undefined)
      return yield* surface;
    return HttpServerResponse.jsonUnsafe(
      { code: 'server-starting', reason: 'the server is starting', unblock: ['wait until /health answers ready'], startup, issue },
      { status: 503, headers: { ...headers, [OUTCOME_HEADER]: 'refusal', 'retry-after': '1' } },
    );
  });
});
