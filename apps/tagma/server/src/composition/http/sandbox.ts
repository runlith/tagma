import { Effect } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { proxyPage } from '../../mcp/sandbox.js';
import type { Access } from '../../remote/contract/service/access.js';

const FRAMERS = ['127.0.0.1', 'localhost', '[::1]'] as const;

const LOCAL_DOORS = FRAMERS.map((name) => `http://${name}:*`).join(' ');

const framedBy = (parent: string | null): string => (parent === null ? LOCAL_DOORS : `${LOCAL_DOORS} ${parent}`);

const unknown = () => HttpServerResponse.text('Nothing is served here.', { status: 404 });

const proxyHost = (host: string | undefined, access: Access['Service']): boolean => {
  const name = host?.toLowerCase().replace(/:\d+$/u, '');
  if (name === '127.0.0.1' || name === 'localhost') return true;
  const remote = access.sandboxOrigin;
  return remote !== null && host?.toLowerCase() === new URL(remote).host;
};

export const sandboxRoutes = (access: Access['Service']) =>
  HttpRouter.add('GET', '*', (request) => {
    const { pathname, searchParams } = new URL(request.url, 'http://sandbox');
    return Effect.succeed(
      pathname === '/' && proxyHost(request.headers.host, access) ? proxyPage(searchParams, framedBy(access.parentOrigin)) : unknown(),
    );
  });
