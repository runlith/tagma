import { McpAppCsp, viewCsp } from '@runlith/mcp/apps';
import { Option, Schema } from 'effect';
import { HttpServerResponse } from 'effect/http';
import type { URLSearchParams } from 'node:url';

const decodeCsp = Schema.decodeUnknownOption(Schema.fromJsonString(McpAppCsp));

export const sandboxPolicy = (declared: McpAppCsp, framers: string): string => {
  const {
    resourceDomains: resource = [],
    connectDomains: connect = [],
    frameDomains: frame = [],
    baseUriDomains: base = [],
  } = viewCsp(declared);
  const listed = (head: readonly string[], tail: readonly string[]) => [...head, ...tail].join(' ');
  return [
    "default-src 'none'",
    `script-src ${listed(["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'blob:'], resource)}`,
    `style-src ${listed(["'self'", "'unsafe-inline'"], resource)}`,
    `img-src ${listed(["'self'", 'data:', 'blob:'], resource)}`,
    `font-src ${listed(["'self'", 'data:'], resource)}`,
    `media-src ${listed(["'self'", 'data:', 'blob:'], resource)}`,
    `worker-src ${listed(["'self'", 'blob:'], resource)}`,
    `connect-src ${connect.length === 0 ? "'none'" : connect.join(' ')}`,
    `frame-src ${frame.length === 0 ? "'none'" : frame.join(' ')}`,
    `base-uri ${base.length === 0 ? "'self'" : base.join(' ')}`,
    "object-src 'none'",
    "form-action 'none'",
    "webrtc 'block'",
    `frame-ancestors ${framers}`,
  ].join('; ');
};

const PROXY = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">
<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%;background:transparent;color-scheme:inherit}</style>
</head><body><script>
(() => {
  const RESERVED = 'ui/notifications/sandbox-';
  const reserved = (data) => typeof data?.method === 'string' && data.method.startsWith(RESERVED);
  const inner = document.createElement('iframe');
  let host = null;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source === window.parent) {
      if (host === null) {
        const params = data?.params;
        if (data?.method !== RESERVED + 'resource-ready' || typeof params?.html !== 'string') return;
        host = event.origin;
        inner.setAttribute('sandbox', 'allow-scripts allow-forms allow-pointer-lock');
        inner.setAttribute('allow', 'fullscreen; autoplay');
        inner.srcdoc = params.html;
        document.body.appendChild(inner);
        return;
      }
      if (event.origin !== host || reserved(data)) return;
      inner.contentWindow?.postMessage(data, '*');
      return;
    }
    if (host !== null && event.source === inner.contentWindow && !reserved(data)) window.parent.postMessage(data, host);
  });
  window.parent.postMessage({ jsonrpc: '2.0', method: RESERVED + 'proxy-ready', params: {} }, '*');
})();
</script></body></html>`;

const proxied = (policy: string) =>
  HttpServerResponse.text(PROXY, { contentType: 'text/html; charset=utf-8' }).pipe(
    HttpServerResponse.setHeaders({
      'content-security-policy': policy,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    }),
  );

export const proxyPage = (query: URLSearchParams, framers: string): HttpServerResponse.HttpServerResponse => {
  const asked = query.get('csp');
  const declared = asked === null ? Option.some({}) : decodeCsp(asked);
  if (Option.isNone(declared)) return HttpServerResponse.text('The csp parameter is not an MCP Apps CSP declaration.', { status: 400 });
  return proxied(sandboxPolicy(declared.value, framers));
};
