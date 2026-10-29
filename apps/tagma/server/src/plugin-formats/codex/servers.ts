import { resolve } from 'node:path';
import { Effect, Schema } from 'effect';
import type { PluginIgnored, PluginPlace, PluginServer } from '../../plugins/contract/service/format.js';
import { declaredPath, entryOf, isObject, jsonOf, textOf } from '../../plugins/contract/service/reading.js';

const Strings = Schema.Record(Schema.String, Schema.String);

const Stdio = Schema.Struct({
  type: Schema.optional(Schema.Literal('stdio')),
  command: Schema.String.check(Schema.isMinLength(1)),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Strings),
  cwd: Schema.optional(Schema.String),
});

const Remote = Schema.Struct({
  type: Schema.Literals(['http', 'streamable-http', 'sse']),
  url: Schema.String.check(Schema.isMinLength(1)),
  oauth_resource: Schema.optional(Schema.String),
});

const decodeServer = Schema.decodeUnknownEffect(Schema.Union([Stdio, Remote]));

const mapOf = (value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
  isObject(value['mcpServers']) ? value['mcpServers'] : value;

const absoluteUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

const stdioOf =
  (server: typeof Stdio.Type): PluginServer['reach'] =>
  (place: PluginPlace) =>
    Effect.succeed({
      transport: 'stdio' as const,
      command: server.command,
      args: server.args,
      cwd: server.cwd === undefined ? place.root : resolve(place.root, server.cwd),
      env: server.env,
    });

const fileMap = Effect.fnUntraced(function* (path: string, label: string, ignored: PluginIgnored[]) {
  const raw = jsonOf(yield* textOf(path));
  if ('reason' in raw) {
    ignored.push({ component: 'mcp servers', name: label, reason: `not JSON: ${raw.reason}` });
    return {};
  }
  if (!isObject(raw.value)) {
    ignored.push({ component: 'mcp servers', name: label, reason: 'not a JSON object of servers' });
    return {};
  }
  return mapOf(raw.value);
});

export const serversOf = Effect.fnUntraced(function* (root: string, declared: unknown, ignored: PluginIgnored[]) {
  const maps = new Map<string, unknown>();
  const take = (map: Readonly<Record<string, unknown>>) => {
    for (const [name, entry] of Object.entries(map)) maps.set(name, entry);
  };
  if (declared === undefined) {
    const standard = yield* entryOf(root, '.mcp.json');
    if (standard.kind === 'file') take(yield* fileMap(standard.path, '.mcp.json', ignored));
  } else {
    for (const shape of Array.isArray(declared) ? declared : [declared]) {
      if (isObject(shape)) take(mapOf(shape));
      else if (typeof shape === 'string') {
        const entry = yield* declaredPath(root, 'mcp servers', shape, ignored);
        if (entry?.kind === 'file') take(yield* fileMap(entry.path, shape, ignored));
        else if (entry !== null) ignored.push({ component: 'mcp servers', name: shape, reason: 'not a JSON file' });
      } else ignored.push({ component: 'mcp servers', name: null, reason: 'an mcpServers entry is neither a path nor a map of servers' });
    }
  }
  const servers: PluginServer[] = [];
  for (const [name, entry] of maps) {
    const decoded = yield* decodeServer(entry).pipe(
      Effect.map((server) => ({ server, failure: null })),
      Effect.catchTag('SchemaError', (failure) => Effect.succeed({ server: null, failure: failure.message })),
    );
    const server = decoded.server;
    if (server === null) {
      ignored.push({ component: 'mcp-server', name, reason: `not an MCP server entry: ${decoded.failure}` });
      continue;
    }
    if (!('url' in server)) {
      servers.push({ name, reach: stdioOf(server) });
      continue;
    }
    if (server.type === 'sse') {
      ignored.push({ component: 'mcp-server', name, reason: 'it uses the deprecated HTTP+SSE transport; Tagma speaks Streamable HTTP' });
      continue;
    }
    if (!absoluteUrl(server.url)) {
      ignored.push({ component: 'mcp-server', name, reason: `its url ${server.url} is not an absolute HTTP or HTTPS URL` });
      continue;
    }
    if (server.oauth_resource !== undefined) {
      ignored.push({
        component: 'mcp-server',
        name: `${name} oauth_resource`,
        reason: 'Tagma signs in from the server URL and reads no oauth_resource hint',
      });
    }
    servers.push({ name, reach: () => Effect.succeed({ transport: 'http' as const, url: server.url }) });
  }
  return servers;
});
