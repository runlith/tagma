import { resolve } from 'node:path';
import { Effect, Schema } from 'effect';
import type { PluginIgnored, PluginPlace, PluginServer, PluginServerReach } from '../../plugins/contract/service/format.js';
import { declaredPath, entryOf, jsonOf, textOf } from '../../plugins/contract/service/reading.js';
import type { Manifest } from './manifest.js';
import { pluginEnvironment, substituted } from './variables.js';

const Strings = Schema.Record(Schema.String, Schema.String);

const Stdio = Schema.Struct({
  type: Schema.optional(Schema.Literal('stdio')),
  command: Schema.String.check(Schema.isMinLength(1)),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Strings),
  cwd: Schema.optional(Schema.String),
});

const Remote = Schema.Struct({
  type: Schema.Literals(['http', 'streamable-http', 'sse', 'ws']),
  url: Schema.String.check(Schema.isMinLength(1)),
  headers: Schema.optional(Strings),
  headersHelper: Schema.optional(Schema.String),
});

const decodeServer = Schema.decodeUnknownEffect(Schema.Union([Stdio, Remote]));

const BUNDLE = /\.(?:mcpb|dxt)$/u;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const mapOf = (value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
  isObject(value['mcpServers']) ? value['mcpServers'] : value;

const all = (text: readonly string[] | undefined, place: PluginPlace) => text?.map((entry) => substituted(entry, place));

const record = (values: Readonly<Record<string, string>> | undefined, place: PluginPlace) =>
  values === undefined ? undefined : Object.fromEntries(Object.entries(values).map(([key, value]) => [key, substituted(value, place)]));

const stdioReach =
  (server: typeof Stdio.Type): PluginServer['reach'] =>
  (place: PluginPlace) =>
    Effect.succeed<PluginServerReach>({
      transport: 'stdio',
      command: substituted(server.command, place),
      args: all(server.args, place),
      cwd: server.cwd === undefined ? place.root : resolve(place.root, substituted(server.cwd, place)),
      env: { ...record(server.env, place), ...pluginEnvironment(place) },
    });

const remoteReach =
  (server: typeof Remote.Type): PluginServer['reach'] =>
  (place: PluginPlace) =>
    Effect.succeed<PluginServerReach>({
      transport: 'http',
      url: substituted(server.url, place),
      headers: record(server.headers, place),
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

export const serversOf = Effect.fnUntraced(function* (root: string, manifest: Manifest | null, ignored: PluginIgnored[]) {
  const declared = new Map<string, unknown>();
  const take = (map: Readonly<Record<string, unknown>>) => {
    for (const [name, entry] of Object.entries(map)) declared.set(name, entry);
  };
  const standard = yield* entryOf(root, '.mcp.json');
  if (standard.kind === 'file') take(yield* fileMap(standard.path, '.mcp.json', ignored));
  const shapes = manifest?.mcpServers === undefined ? [] : Array.isArray(manifest.mcpServers) ? manifest.mcpServers : [manifest.mcpServers];
  for (const shape of shapes) {
    if (isObject(shape)) take(shape);
    else if (typeof shape === 'string' && BUNDLE.test(shape)) {
      ignored.push({ component: 'mcp bundle', name: shape, reason: 'MCPB bundles are not read' });
    } else if (typeof shape === 'string') {
      const entry = yield* declaredPath(root, 'mcp servers', shape, ignored);
      if (entry?.kind === 'file') take(yield* fileMap(entry.path, shape, ignored));
      else if (entry !== null) ignored.push({ component: 'mcp servers', name: shape, reason: 'not a JSON file' });
    } else ignored.push({ component: 'mcp servers', name: null, reason: 'an mcpServers entry is neither a path nor a map of servers' });
  }
  const servers: PluginServer[] = [];
  for (const [name, entry] of declared) {
    const decoded = yield* decodeServer(entry).pipe(
      Effect.map((server) => ({ server, failure: null })),
      Effect.catchTag('SchemaError', (failure) => Effect.succeed({ server: null, failure: failure.message })),
    );
    const server = decoded.server;
    if (server === null) {
      ignored.push({ component: 'mcp-server', name, reason: `not an MCP server entry: ${decoded.failure}` });
      continue;
    }
    if (server.type === 'sse') {
      ignored.push({ component: 'mcp-server', name, reason: 'it uses the deprecated HTTP+SSE transport; Tagma speaks Streamable HTTP' });
      continue;
    }
    if (server.type === 'ws') {
      ignored.push({ component: 'mcp-server', name, reason: 'Tagma does not speak MCP over WebSocket' });
      continue;
    }
    if ('url' in server && server.headersHelper !== undefined) {
      ignored.push({ component: 'mcp-server', name, reason: 'it needs a headersHelper, and Tagma runs no header helper' });
      continue;
    }
    servers.push({ name, reach: 'url' in server ? remoteReach(server) : stdioReach(server) });
  }
  return servers;
});
