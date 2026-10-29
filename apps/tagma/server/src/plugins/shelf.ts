import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { PERMISSION_KINDS } from '@runlith/agent/permissions';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Effect, Exit, FileSystem, Option } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import { type PluginPackage, type PluginPlace, PluginFormats, type PluginRefused, PluginUnreadable } from './contract/service/format.js';
import type { PluginLoaded } from './contract/service/plugins.js';
import { componentName } from './contract/wire/names.js';
import { pluginsOptions } from './contract/wire/settings.js';
import { type NamesCollide, type Read, readPlugin } from './reader.js';
import { dataRoot } from './sources.js';

export const SECRET_KIND = 'plugins';

const WATCHED = [
  '.',
  '.claude-plugin/plugin.json',
  'plugin.json',
  'skills',
  'commands',
  'agents',
  'hooks/hooks.json',
  '.mcp.json',
  'mcp.json',
];

export type ReadFailure = PluginRefused | PluginUnreadable | NamesCollide;

type Cached = { readonly stamp: string; readonly read: Exit.Exit<Read, ReadFailure> };

export type Bound = { readonly loaded: PluginLoaded; readonly options: Readonly<Record<string, string>> };

export const makeShelf = Effect.fnUntraced(function* (input: { readonly home: string }) {
  const formats = yield* PluginFormats;
  const settings = yield* Settings;
  const owners = yield* SecretOwners;
  const files = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const cache = new Map<string, Cached>();
  const prepared = new Set<string>();

  const stampOf = (root: string) =>
    Effect.map(
      Effect.forEach(WATCHED, (path) =>
        files.stat(join(root, path)).pipe(
          Effect.map((info) => `${path}:${Option.match(info.mtime, { onNone: () => '', onSome: (at) => at.getTime() })}`),
          Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(`${path}:-`)),
          Effect.mapError((failure) => new PluginUnreadable({ path: join(root, path), reason: failure.message })),
        ),
      ),
      (parts) => parts.join('|'),
    );

  const read = Effect.fn('PluginShelf.read')(function* (root: string) {
    const stamp = yield* stampOf(root);
    const standing = cache.get(root);
    if (standing !== undefined && standing.stamp === stamp) return yield* standing.read;
    const fresh = yield* Effect.exit(readPlugin(formats, root).pipe(Effect.provideService(FileSystem.FileSystem, files)));
    cache.set(root, { stamp, read: fresh });
    return yield* fresh;
  });

  const values = Effect.fn('PluginShelf.values')(function* (id: string, read: PluginPackage) {
    const set = (yield* settings.value(pluginsOptions))[id] ?? {};
    const secret: { readonly values: Readonly<Record<string, string>>; readonly redact: readonly string[] } = read.options.some(
      (option) => option.sensitive,
    )
      ? (yield* owners.handout(SECRET_KIND).pipe(
          Effect.mapError(
            () =>
              new PluginUnreadable({
                path: 'secrets.json',
                reason: 'the secret store could not be read, so its secret options do not resolve',
              }),
          ),
        ))(id)
      : { values: {}, redact: [] };
    const options: Record<string, string> = {};
    for (const option of read.options) {
      const value = option.sensitive ? secret.values[option.key] : set[option.key];
      const chosen = value === undefined || value === '' ? option.fallback : value;
      if (chosen !== null) options[option.key] = chosen;
    }
    return { options, redact: secret.redact };
  });

  const placeOf = (id: string, root: string, project: string, options: Readonly<Record<string, string>>): PluginPlace => ({
    root,
    data: dataRoot(input.home, id),
    options,
    project,
  });

  const declarationOf = (id: string, read: PluginPackage, place: PluginPlace) =>
    read.servers.map((server): McpServerDeclaration => {
      const reach = server.reach(place);
      const shared = {
        name: componentName(id, server.name),
        capabilities: { kinds: [...PERMISSION_KINDS], mutates: true },
        enabled: true,
      };
      return reach.transport === 'stdio'
        ? { ...shared, transport: 'stdio', command: reach.command, args: reach.args, cwd: reach.cwd, env: reach.env }
        : { ...shared, transport: 'http', url: reach.url, headers: reach.headers };
    });

  const dataReady = Effect.fn('PluginShelf.dataReady')(function* (id: string) {
    if (prepared.has(id)) return;
    const at = dataRoot(input.home, id);
    yield* files
      .makeDirectory(at, { recursive: true })
      .pipe(Effect.mapError((failure) => new PluginUnreadable({ path: at, reason: failure.message })));
    prepared.add(id);
  });

  const bind = Effect.fn('PluginShelf.bind')(function* (read: Read, root: string, project: string) {
    const { id, package: pkg } = read;
    const { options, redact } = yield* values(id, pkg);
    const place = placeOf(id, root, project, options);
    yield* dataReady(id);
    const provided = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
      Effect.provideService(effect, FileSystem.FileSystem, files);
    const revision = createHash('sha256')
      .update(JSON.stringify([cache.get(root)?.stamp ?? '', place]))
      .digest('hex')
      .slice(0, 16);
    const loaded: PluginLoaded = {
      id,
      revision,
      title: pkg.title ?? pkg.name,
      place,
      redact,
      skills: pkg.skills.map((skill) => ({ ...skill, name: componentName(id, skill.name) })),
      commands: pkg.commands.map((command) => ({
        name: componentName(id, command.name),
        description: command.description,
        body: provided(command.body(place)),
      })),
      agents: pkg.agents.map((agent) => ({
        name: componentName(id, agent.name),
        file: agent.file,
        description: agent.description,
        prompt: provided(agent.prompt(place)),
        tools: agent.tools,
      })),
      servers: declarationOf(id, pkg, place),
      hooks: pkg.hooks.map((hook) => ({
        point: hook.point,
        label: hook.label,
        matches: hook.matches,
        run: (call, session) => Effect.provideService(hook.run(call, session, place), ChildProcessSpawner.ChildProcessSpawner, spawner),
      })),
    };
    return { loaded, options } satisfies Bound;
  });

  return { read, bind, forget: (root: string) => cache.delete(root) };
});

export type Shelf = Effect.Success<ReturnType<typeof makeShelf>>;
