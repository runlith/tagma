import type { Runtime } from '../runtime';

const LTS = '24';
const SCHEME = 'node:';
const NAMES: ReadonlySet<string> = new Set([
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  '_tls_common',
  '_tls_wrap',
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);
const SCHEMED: ReadonlySet<string> = new Set(['sea', 'sqlite', 'test']);

export const node: Runtime = {
  id: 'node',
  conditions: ['node'],
  provides: [],
  builtin: (specifier) => {
    const schemed = specifier.startsWith(SCHEME);
    const head = (schemed ? specifier.slice(SCHEME.length) : specifier).split('/')[0]!;
    if (NAMES.has(head)) return head;
    return schemed && SCHEMED.has(head) ? `${SCHEME}${head}` : undefined;
  },
  limitation: `Node built-ins are pinned to Node ${LTS} LTS, not the measuring runtime.`,
};
