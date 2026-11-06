import { type McpAppCsp, viewCsp } from '@runlith/mcp/apps';
import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import type { PluginViews } from './contract/service/views.js';

const listed = (own: readonly string[], declared: readonly string[] | undefined) => [...own, ...(declared ?? [])].join(' ');

const reached = (declared: readonly string[] | undefined, none: string) =>
  declared === undefined || declared.length === 0 ? none : declared.join(' ');

const policyOf = (asked: McpAppCsp, framers: string): string => {
  const csp = viewCsp(asked);
  return [
    "default-src 'self'",
    `script-src ${listed(["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'blob:'], csp.resourceDomains)}`,
    `style-src ${listed(["'self'", "'unsafe-inline'"], csp.resourceDomains)}`,
    `img-src ${listed(["'self'", 'data:', 'blob:'], csp.resourceDomains)}`,
    `media-src ${listed(["'self'", 'data:', 'blob:'], csp.resourceDomains)}`,
    `font-src ${listed(["'self'", 'data:'], csp.resourceDomains)}`,
    `connect-src ${listed(["'self'", 'data:', 'blob:'], csp.connectDomains)}`,
    `worker-src ${listed(["'self'", 'blob:'], csp.resourceDomains)}`,
    `frame-src ${reached(csp.frameDomains, "'none'")}`,
    "object-src 'none'",
    `base-uri ${reached(csp.baseUriDomains, "'self'")}`,
    "form-action 'none'",
    "webrtc 'block'",
    `frame-ancestors ${framers}`,
  ].join('; ');
};

const SHARED = {
  'access-control-allow-origin': '*',
  'cache-control': 'no-cache',
  'x-content-type-options': 'nosniff',
};

const ESCAPE = /%(?![0-7][0-9a-f])/iu;

const safeDecode = (path: string): string | null => (ESCAPE.test(path) ? null : decodeURIComponent(path));

const missing = () => HttpServerResponse.text('No such file of a plugin view.', { status: 404 });

export const siteFile = (views: PluginViews['Service']) =>
  Effect.fn('views.siteFile')(function* (plugin: string, pathname: string, framers: string) {
    const path = safeDecode(pathname.slice(1));
    if (path === null) return missing();
    const file = yield* views.file(plugin, path);
    if (file === null) return missing();
    const csp = yield* views.csp(plugin, path);
    const response = yield* HttpServerResponse.file(file, { contentType: Bun.file(file).type });
    return HttpServerResponse.setHeaders(response, { ...SHARED, 'content-security-policy': policyOf(csp, framers) });
  });
