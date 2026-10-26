import { Effect } from 'effect';
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from 'effect/http';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const loopbackPort = (origin: string): number | null => {
  if (!URL.canParse(origin)) return null;
  const url = new URL(origin);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LOOPBACK.has(url.hostname)) return null;
  return url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
};

const refused = (reason: string) =>
  HttpServerResponse.jsonUnsafe(
    { code: 'origin-refused', reason, unblock: ['open Tagma from this machine, or pair the device through the door for other networks'] },
    { status: 403 },
  );

export const localGate = (foreignPorts: readonly number[]) =>
  HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      const { headers } = yield* HttpServerRequest.HttpServerRequest;
      const host = headers.host;
      if (host !== undefined && loopbackPort(`http://${host}`) === null)
        return refused(`the Tagma server on this machine does not answer to ${host}`);
      const origin = headers.origin;
      if (origin === undefined) return yield* app;
      const port = loopbackPort(origin);
      if (port === null || foreignPorts.includes(port)) return refused(`a page of ${origin} may not call the Tagma server on this machine`);
      return yield* app;
    }),
  );
