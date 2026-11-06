import { basename, dirname, join, resolve } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import {
  type PluginIgnored,
  type PluginPlace,
  PluginRefused,
  type PluginServer,
  type PluginServerReach,
  PluginUnreadable,
} from '../../plugins/contract/service/format.js';
import { entryOf, jsonOf, textOf, within } from '../../plugins/contract/service/reading.js';

export const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

const RESERVED = ['PLUGIN_ROOT', 'PLUGIN_DATA'];
const PLACEHOLDER = /\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/gu;
const CWD_FORM = /^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/u;
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/u;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

const Strings = Schema.Record(Schema.String, Schema.String);

const Extensions = Schema.optional(Schema.Record(Schema.String, Schema.Unknown));

const Stdio = Schema.Struct({
  type: Schema.Literal('stdio'),
  command: Schema.String.check(Schema.isMinLength(1)),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Strings),
  cwd: Schema.optional(Schema.String),
  extensions: Extensions,
});

const Remote = Schema.Struct({
  type: Schema.Literals(['streamable-http', 'sse']),
  url: Schema.String.check(Schema.isMinLength(1)),
  headers: Schema.optional(Strings),
  extensions: Extensions,
});

const Server = Schema.Union([Stdio, Remote]);

const Config = Schema.Struct({ $schema: Schema.String, mcpServers: Schema.Record(Schema.String, Schema.Unknown) });

const decodeServer = Schema.decodeUnknownEffect(Server);
const decodeConfig = Schema.decodeUnknownEffect(Config);

const staysBelow = (rest: string): boolean => within('/data', resolve('/data', `.${rest}`));

const expanded = (text: string, place: PluginPlace): string =>
  text.replaceAll(PLACEHOLDER, (_whole, name: string) => (name === 'PLUGIN_ROOT' ? place.root : place.data));

const resolvedWithin = Effect.fnUntraced(function* (base: string, path: string) {
  const files = yield* FileSystem.FileSystem;
  const failed = (failure: { readonly message: string }) => new PluginUnreadable({ path, reason: failure.message });
  const real = yield* files.realPath(base).pipe(Effect.mapError(failed));
  let standing = path;
  let rest = '';
  while (!(yield* files.exists(standing).pipe(Effect.mapError(failed)))) {
    rest = rest === '' ? basename(standing) : join(basename(standing), rest);
    standing = dirname(standing);
  }
  return within(real, join(yield* files.realPath(standing).pipe(Effect.mapError(failed)), rest));
});

const stdioReach = Effect.fnUntraced(function* (server: typeof Stdio.Type, root: string, place: PluginPlace) {
  const env = Object.fromEntries(Object.entries(server.env ?? {}).map(([key, value]) => [key, expanded(value, place)]));
  const cwd = server.cwd === undefined ? place.root : resolve(place.root, expanded(server.cwd, place));
  if (server.cwd?.startsWith('${PLUGIN_DATA}') === true && !(yield* resolvedWithin(place.data, cwd))) {
    return yield* new PluginRefused({ reason: `its cwd ${server.cwd} resolves outside the plugin's data directory` });
  }
  return {
    transport: 'stdio',
    command: server.command.startsWith('./') ? join(root, server.command) : server.command,
    args: (server.args ?? []).map((arg) => expanded(arg, place)),
    cwd,
    env: { ...env, PLUGIN_ROOT: place.root, PLUGIN_DATA: place.data },
  } satisfies PluginServerReach;
});

const reachOf =
  (server: typeof Stdio.Type, root: string): PluginServer['reach'] =>
  (place) =>
    stdioReach(server, root, place);

const stdioProblem = Effect.fnUntraced(function* (root: string, server: typeof Stdio.Type) {
  if (server.command.startsWith('./')) {
    const command = yield* entryOf(root, server.command);
    if (command.kind !== 'file') return `its command ${server.command} is not a file inside the plugin`;
  } else if (/[\s/\\]/u.test(server.command)) return `its command ${server.command} is neither one executable name nor a ./ path`;
  const reserved = Object.keys(server.env ?? {}).filter((key) => RESERVED.includes(key));
  if (reserved.length > 0) return `its env sets ${reserved.join(' and ')}, which the client supplies`;
  if (server.cwd === undefined) return null;
  if (!CWD_FORM.test(server.cwd)) return `its cwd ${server.cwd} is neither ./, \${PLUGIN_ROOT} nor \${PLUGIN_DATA} rooted`;
  if (server.cwd.startsWith('${PLUGIN_DATA}')) {
    return staysBelow(server.cwd.slice('${PLUGIN_DATA}'.length)) ? null : `its cwd ${server.cwd} leaves the data directory`;
  }
  const local = server.cwd.startsWith('./') ? server.cwd : `.${server.cwd.slice('${PLUGIN_ROOT}'.length)}`;
  const cwd = yield* entryOf(root, local);
  return cwd.kind === 'outside' ? `its cwd ${server.cwd} leaves the plugin` : null;
});

const remoteProblem = (server: typeof Remote.Type): string | null => {
  let url: URL;
  try {
    url = new URL(server.url);
  } catch {
    return `its url ${server.url} is not an absolute URL`;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return `its url ${server.url} is not HTTP or HTTPS`;
  if (url.username !== '' || url.password !== '' || server.url.includes('#'))
    return `its url ${server.url} carries user information or a fragment`;
  if (url.protocol === 'http:' && !LOOPBACK.test(url.hostname))
    return `its url ${server.url} reaches a host other than loopback over plain HTTP`;
  const names = Object.keys(server.headers ?? {}).map((name) => name.toLowerCase());
  if (names.some((name) => !HEADER_NAME.test(name))) return 'a header name is not a valid HTTP field name';
  if (new Set(names).size !== names.length) return 'a header is named twice in different cases';
  return null;
};

export const serversOf = Effect.fnUntraced(function* (root: string, ignored: PluginIgnored[]) {
  const file = yield* entryOf(root, 'mcp.json');
  if (file.kind === 'absent') return [] as PluginServer[];
  if (file.kind !== 'file') {
    ignored.push({ component: 'mcp.json', name: null, reason: 'mcp.json is not a file inside the plugin, so its MCP servers are off' });
    return [] as PluginServer[];
  }
  const off = (reason: string) => {
    ignored.push({ component: 'mcp.json', name: null, reason: `${reason}, so its MCP servers are off` });
    return [] as PluginServer[];
  };
  const raw = jsonOf(yield* textOf(file.path));
  if ('reason' in raw) return off(`mcp.json is not JSON: ${raw.reason}`);
  const config = yield* decodeConfig(raw.value, { onExcessProperty: 'error' }).pipe(
    Effect.map((value) => ({ value, failure: null })),
    Effect.catchTag('SchemaError', (failure) => Effect.succeed({ value: null, failure: failure.message })),
  );
  if (config.value === null) return off(`mcp.json holds other than $schema and an mcpServers object: ${config.failure}`);
  if (config.value.$schema !== MCP_SCHEMA)
    return off(`mcp.json targets ${config.value.$schema}, not the Agent Plugins 1.0.0 MCP schema plugin.json targets`);
  const servers: PluginServer[] = [];
  for (const [name, entry] of Object.entries(config.value.mcpServers)) {
    const decoded = yield* decodeServer(entry, { onExcessProperty: 'error' }).pipe(
      Effect.map((server) => ({ server, failure: null })),
      Effect.catchTag('SchemaError', (failure) => Effect.succeed({ server: null, failure: failure.message })),
    );
    if (decoded.server === null) {
      ignored.push({ component: 'mcp-server', name, reason: `its entry does not match one MCP server variant: ${decoded.failure}` });
      continue;
    }
    const server = decoded.server;
    for (const namespace of Object.keys(server.extensions ?? {})) {
      ignored.push({
        component: 'mcp-server extension',
        name: `${name}: ${namespace}`,
        reason: 'a client extension Tagma does not implement',
      });
    }
    const read = yield* serverOf(root, name, server, ignored);
    if (read !== null) servers.push(read);
  }
  return servers;
});

type PortableServer = Omit<typeof Stdio.Type, 'extensions'> | Omit<typeof Remote.Type, 'extensions'>;

export const serverOf = Effect.fnUntraced(function* (root: string, name: string, server: PortableServer, ignored: PluginIgnored[]) {
  if (server.type === 'sse') {
    ignored.push({ component: 'mcp-server', name, reason: 'it uses the deprecated HTTP+SSE transport; Tagma speaks Streamable HTTP' });
    return null;
  }
  const problem = server.type === 'stdio' ? yield* stdioProblem(root, server) : remoteProblem(server);
  if (problem !== null) {
    ignored.push({ component: 'mcp-server', name, reason: problem });
    return null;
  }
  return server.type === 'stdio'
    ? ({ name, reach: reachOf(server, root) } satisfies PluginServer)
    : ({
        name,
        reach: () => Effect.succeed({ transport: 'http' as const, url: server.url, headers: server.headers }),
      } satisfies PluginServer);
});
