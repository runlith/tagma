import { createHash } from 'node:crypto';
import { PERMISSION_KINDS } from '@runlith/agent/permissions';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Effect, FileSystem, Option } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { maskedForms, SecretOwners } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import {
  type PluginIgnored,
  type PluginPackage,
  type PluginPlace,
  PluginFormats,
  PluginRefused,
  PluginUnreadable,
} from './contract/service/format.js';
import type { LoadedHook, PluginLoaded } from './contract/service/plugins.js';
import { PluginReads } from './contract/service/reading.js';
import { componentName } from './contract/wire/names.js';
import type { PluginDeclared } from './contract/wire/rows.js';
import { pluginsOptions } from './contract/wire/settings.js';
import { type NamesCollide, type Read, readPlugin } from './reader.js';
import { dataRoot } from './sources.js';

export const SECRET_KIND = 'plugins';

export type ReadFailure = PluginRefused | PluginUnreadable | NamesCollide;

type Cached = { readonly paths: readonly string[]; readonly stamp: string; readonly read: Read };

export type Bound = {
  readonly loaded: PluginLoaded;
  readonly options: Readonly<Record<string, string>>;
  readonly skipped: readonly PluginIgnored[];
};

export const makeShelf = Effect.fnUntraced(function* (input: { readonly home: string }) {
  const formats = yield* PluginFormats;
  const settings = yield* Settings;
  const owners = yield* SecretOwners;
  const files = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const cache = new Map<string, Cached>();
  const prepared = new Set<string>();

  const stampOf = (paths: readonly string[]) =>
    Effect.map(
      Effect.forEach(paths, (path) =>
        files.stat(path).pipe(
          Effect.map((info) => Option.match(info.mtime, { onNone: () => '', onSome: (at) => String(at.getTime()) })),
          Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed('-')),
          Effect.mapError((failure) => new PluginUnreadable({ path, reason: failure.message })),
        ),
      ),
      (parts) => parts.join('|'),
    );

  const read = Effect.fn('PluginShelf.read')(function* (root: string, declared: PluginDeclared | null) {
    const standing = cache.get(root);
    if (standing !== undefined && standing.stamp === (yield* stampOf(standing.paths))) return standing.read;
    const reads = new Set<string>([root]);
    const fresh = yield* readPlugin(formats, root, declared).pipe(
      Effect.provideService(FileSystem.FileSystem, files),
      Effect.provideService(PluginReads, reads),
      Effect.tapError(() => Effect.sync(() => cache.delete(root))),
    );
    const paths = [...reads].sort();
    cache.set(root, { paths, stamp: yield* stampOf(paths), read: fresh });
    return fresh;
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
    const redact = [...secret.redact];
    for (const option of read.options) {
      const value = option.sensitive ? secret.values[option.key] : set[option.key];
      const chosen = value === undefined || value === '' ? option.fallback : value;
      if (chosen === null) continue;
      options[option.key] = chosen;
      if (option.sensitive && chosen === option.fallback && chosen !== '') redact.push(...maskedForms(chosen));
    }
    return { options, redact };
  });

  const placeOf = (id: string, root: string, project: string, options: Readonly<Record<string, string>>): PluginPlace => ({
    root,
    data: dataRoot(input.home, id),
    options,
    project,
  });

  const declarationsOf = Effect.fnUntraced(function* (id: string, read: PluginPackage, place: PluginPlace) {
    const declarations: McpServerDeclaration[] = [];
    const skipped: PluginIgnored[] = [];
    for (const server of read.servers) {
      const reach = yield* server.reach(place).pipe(
        Effect.provideService(FileSystem.FileSystem, files),
        Effect.catchTag('PluginRefused', (refused) => Effect.succeed(refused)),
      );
      if (reach instanceof PluginRefused) {
        skipped.push({ component: 'mcp-server', name: server.name, reason: reach.reason });
        continue;
      }
      const shared = {
        name: componentName(id, server.name),
        capabilities: { kinds: [...PERMISSION_KINDS], mutates: true },
        enabled: true,
      };
      declarations.push(
        reach.transport === 'stdio'
          ? { ...shared, transport: 'stdio', command: reach.command, args: reach.args, cwd: reach.cwd, env: reach.env }
          : { ...shared, transport: 'http', url: reach.url, headers: reach.headers },
      );
    }
    return { declarations, skipped };
  });

  const dataReady = Effect.fn('PluginShelf.dataReady')(function* (id: string) {
    if (prepared.has(id)) return;
    const at = dataRoot(input.home, id);
    yield* files
      .makeDirectory(at, { recursive: true })
      .pipe(Effect.mapError((failure) => new PluginUnreadable({ path: at, reason: failure.message })));
    prepared.add(id);
  });

  const hooksAt = (pkg: PluginPackage, place: PluginPlace): readonly LoadedHook[] =>
    pkg.hooks.map((hook) => ({
      at: hook.at,
      label: hook.label,
      matches: hook.matches,
      run: (call, session) => Effect.provideService(hook.run(call, session, place), ChildProcessSpawner.ChildProcessSpawner, spawner),
    }));

  const hooks = Effect.fn('PluginShelf.hooks')(function* (read: Read, root: string, project: string) {
    const { options } = yield* values(read.id, read.package);
    return hooksAt(read.package, placeOf(read.id, root, project, options));
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
    const { declarations, skipped } = yield* declarationsOf(id, pkg, place);
    const loaded: PluginLoaded = {
      id,
      revision,
      title: pkg.title ?? pkg.name,
      place,
      redact,
      skills: pkg.skills.map((skill) => ({
        name: componentName(id, skill.name),
        directory: skill.directory,
        file: skill.file,
        root,
        render: (text: string) => skill.render(text, place),
      })),
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
      servers: declarations,
      hooks: hooksAt(pkg, place),
      process: pkg.process,
      providers: pkg.providers,
      contributes: pkg.contributes,
    };
    return { loaded, options, skipped } satisfies Bound;
  });

  const look = Effect.fn('PluginShelf.look')(function* (root: string, declared: PluginDeclared | null) {
    return yield* readPlugin(formats, root, declared).pipe(
      Effect.provideService(FileSystem.FileSystem, files),
      Effect.provideService(PluginReads, new Set<string>()),
    );
  });

  return { read, look, bind, hooks, values, data: (id: string) => dataRoot(input.home, id), forget: (root: string) => cache.delete(root) };
});

export type Shelf = Effect.Success<ReturnType<typeof makeShelf>>;
