import { Effect, PubSub, Stream } from 'effect';
import { ContributionPoint } from '../platform/contract/service/contribution.js';
import { Projects } from '../projects/contract/service/registry.js';
import { type SecretOwner, SecretOwnerFailed } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import { PluginRefused, PluginUnreadable } from './contract/service/format.js';
import { HookWithdrawn, toolHook } from './contract/service/hooks.js';
import {
  EnabledPlugins,
  HostedPlugins,
  type LoadedHook,
  type PluginHostedRoot,
  type PluginLoaded,
  PluginsUnreadable,
  PluginUnhosted,
  type ProviderParts,
} from './contract/service/plugins.js';
import type { PluginContribution, PluginPoints } from './contract/service/points.js';
import { type HookEntries, HOOKS_FACE } from './contract/wire/hooks.js';
import { type PluginInstall, pluginsDisabled, pluginsEnabled, pluginsInstalled, pluginsOff } from './contract/wire/settings.js';
import type { Digests } from './digests.js';
import { enablingIn, runningOf } from './enabling.js';
import { hosted, type Read } from './reader.js';
import { SECRET_KIND, type Shelf } from './shelf.js';

const HOOKS = new ContributionPoint<never, HookEntries>('plugins/hooks', HOOKS_FACE);

export const makeEnabled = Effect.fnUntraced(function* (input: {
  readonly shelf: Shelf;
  readonly digests: Digests;
  readonly points: PluginPoints['Service'];
  readonly pulses: PubSub.PubSub<number | null>;
  readonly rebuilds: PubSub.PubSub<string>;
  readonly values: PubSub.PubSub<string>;
  readonly parts: ProviderParts['Service'];
}) {
  const { shelf, digests, points, pulses, rebuilds, values, parts } = input;
  const settings = yield* Settings;
  const projects = yield* Projects;
  const hooks = yield* points.hold(HOOKS);
  const toolHooks = new WeakMap<PluginContribution<HookEntries>, Map<number, readonly LoadedHook[]>>();
  const runningIn = new Map<number, () => readonly string[]>();
  const bound = new Map<string, { readonly read: Read; readonly version: number; readonly hooks: readonly LoadedHook[] }>();
  let version = 0;
  yield* Effect.forkScoped(
    Stream.runForEach(Stream.fromPubSub(pulses), () =>
      Effect.sync(() => {
        version += 1;
      }),
    ),
  );

  const toolHooksOf = (plugin: string, projectId: number): readonly LoadedHook[] => {
    const contribution = hooks.of(plugin);
    if (contribution === undefined || contribution.value.length === 0) return [];
    let made = toolHooks.get(contribution);
    if (made === undefined) {
      made = new Map();
      toolHooks.set(contribution, made);
    }
    let declared = made.get(projectId);
    if (declared === undefined) {
      const admit = Effect.suspend(() =>
        hooks.of(plugin) === contribution && (runningIn.get(projectId)?.() ?? []).includes(plugin)
          ? Effect.void
          : Effect.fail(new HookWithdrawn()),
      );
      const place = { plugin, projectId, caller: contribution.caller, admit };
      declared = contribution.value.map((entry) => toolHook(entry, place));
      made.set(projectId, declared);
    }
    return declared;
  };

  const unreadable = (failure: { readonly message: string }) => new PluginsUnreadable({ reason: failure.message });

  const refusedHere = (id: string) => (refused: { readonly message: string }) =>
    Effect.as(Effect.logWarning(`the plugin ${id} contributes nothing while its directory is refused: ${refused.message}`), null);

  const readRefused = (id: string) => ({
    PluginRefused: refusedHere(id),
    PluginUnreadable: refusedHere(id),
    NamesCollide: refusedHere(id),
  });

  const installs = settings.value(pluginsInstalled).pipe(Effect.mapError(unreadable));

  const of = Effect.fn('EnabledPlugins.of')(function* (projectId: number) {
    const enabled = (yield* enablingIn(settings, projectId).pipe(Effect.mapError(unreadable))).running;
    if (enabled.size === 0) return [] as readonly PluginLoaded[];
    const installed = yield* installs;
    const project = (yield* projects.byId(projectId).pipe(Effect.mapError(unreadable))).rootPath;
    const loaded: PluginLoaded[] = [];
    for (const id of enabled) {
      const install = installed.find((entry) => entry.id === id);
      if (install === undefined) continue;
      const read = yield* shelf.read(install.root, install.declared ?? null).pipe(Effect.catchTags(readRefused(id)));
      if (read === null) continue;
      loaded.push((yield* shelf.bind(read, install.root, project).pipe(Effect.mapError(unreadable))).loaded);
    }
    return loaded;
  });

  const held = Effect.fn('EnabledPlugins.held')(function* (projectId: number) {
    const enabled = yield* settings.held(pluginsEnabled, projectId).pipe(Effect.mapError(unreadable));
    const off = yield* settings.held(pluginsDisabled, projectId).pipe(Effect.mapError(unreadable));
    const machineOff = yield* settings.held(pluginsOff, projectId).pipe(Effect.mapError(unreadable));
    type Seen = {
      readonly enabled: readonly string[];
      readonly off: readonly string[];
      readonly machineOff: readonly string[];
      readonly running: readonly string[];
    };
    let seen: Seen | null = null;
    return (): readonly string[] => {
      const now = { enabled: enabled(), off: off(), machineOff: machineOff() };
      if (seen !== null && seen.enabled === now.enabled && seen.off === now.off && seen.machineOff === now.machineOff) return seen.running;
      seen = { ...now, running: runningOf(now.enabled, now.off, now.machineOff) };
      return seen.running;
    };
  });

  const hooksOf = Effect.fn('EnabledPlugins.hooks')(function* (projectId: number) {
    let running = runningIn.get(projectId);
    if (running === undefined) {
      running = yield* held(projectId);
      runningIn.set(projectId, running);
    }
    const enabled = running();
    if (enabled.length === 0) return [] as readonly LoadedHook[];
    const installed = yield* installs;
    const now = version;
    let project: string | null = null;
    const found: LoadedHook[] = [];
    for (const id of enabled) {
      const install = installed.find((entry) => entry.id === id);
      if (install === undefined) continue;
      const read = yield* shelf.read(install.root, install.declared ?? null).pipe(Effect.catchTags(readRefused(id)));
      if (read === null) continue;
      const key = `${projectId}\n${id}`;
      let standing = bound.get(key);
      if (standing === undefined || standing.read !== read || standing.version !== now) {
        project ??= (yield* projects.byId(projectId).pipe(Effect.mapError(unreadable))).rootPath;
        standing = { read, version: now, hooks: yield* shelf.hooks(read, install.root, project).pipe(Effect.mapError(unreadable)) };
        bound.set(key, standing);
      }
      found.push(...standing.hooks, ...toolHooksOf(id, projectId));
    }
    return found;
  });

  const anywhere = Effect.fnUntraced(function* () {
    const running = new Map<string, number[]>();
    for (const project of yield* projects.list().pipe(Effect.mapError(unreadable))) {
      for (const id of (yield* enablingIn(settings, project.id).pipe(Effect.mapError(unreadable))).running) {
        const there = running.get(id) ?? [];
        there.push(project.id);
        running.set(id, there);
      }
    }
    return running;
  });

  const hostedRoot = Effect.fnUntraced(function* (install: PluginInstall, there: readonly number[] | undefined) {
    if (there === undefined) return null;
    const taken = yield* shelf.read(install.root, install.declared ?? null).pipe(
      Effect.map((found) => hosted(found.package)),
      Effect.catchTags({
        PluginRefused: () => Effect.succeed(true),
        PluginUnreadable: () => Effect.succeed(true),
        NamesCollide: () => Effect.succeed(true),
      }),
    );
    return taken ? ({ root: install.root, projects: [...there].sort((a, b) => a - b) } satisfies PluginHostedRoot) : null;
  });

  const roots = Effect.fn('HostedPlugins.roots')(function* () {
    const running = yield* anywhere();
    const listed = new Map<string, PluginHostedRoot>();
    for (const install of yield* installs) {
      const taken = yield* hostedRoot(install, running.get(install.id));
      if (taken !== null) listed.set(install.id, taken);
    }
    return listed;
  });

  const root = Effect.fn('HostedPlugins.root')(function* (id: string) {
    const install = (yield* installs).find((entry) => entry.id === id);
    return install === undefined ? null : yield* hostedRoot(install, (yield* anywhere()).get(id));
  });

  const read = Effect.fn('HostedPlugins.read')(function* (id: string) {
    const install = (yield* installs).find((entry) => entry.id === id);
    if (install === undefined) return yield* new PluginUnhosted({ id });
    const found = yield* shelf
      .read(install.root, install.declared ?? null)
      .pipe(Effect.catchTag('NamesCollide', (collided) => Effect.fail(new PluginRefused({ reason: collided.reason }))));
    const pkg = found.package;
    if (!hosted(pkg)) return yield* new PluginUnhosted({ id });
    const { options, redact } = yield* shelf
      .values(id, pkg)
      .pipe(Effect.mapError((failure) => (failure._tag === 'PluginUnreadable' ? failure : unreadable(failure))));
    const outputs = pkg.build?.outputs ?? [];
    const digest = yield* digests.digest(install.root, outputs, 'outputs').pipe(Effect.mapError(unreadable));
    if (digest === null) {
      return yield* new PluginUnreadable({ path: install.root, reason: `${outputs.join(' or ')} went missing while it was read` });
    }
    const processDigest =
      pkg.process === null ? null : yield* digests.digest(install.root, [pkg.process.entry], 'process').pipe(Effect.mapError(unreadable));
    return {
      id,
      title: pkg.title ?? pkg.name,
      root: install.root,
      data: shelf.data(id),
      digest,
      processDigest,
      process: pkg.process,
      contributes: pkg.contributes,
      options,
      redact,
    };
  });

  const owner: SecretOwner = {
    kind: SECRET_KIND,
    holders: Effect.fn('EnabledPlugins.holders')(
      function* (projectId: number) {
        const { running } = yield* enablingIn(settings, projectId);
        const provided = new Set(parts.current().flatMap((part) => (part.builtin || part.off ? [] : [part.id])));
        const installed = yield* settings.value(pluginsInstalled);
        const holders = [];
        for (const install of installed) {
          const { id } = install;
          if (!running.has(id) && !provided.has(id)) continue;
          const found = yield* shelf.read(install.root, install.declared ?? null).pipe(Effect.catchTags(readRefused(id)));
          if (found === null) continue;
          const entries = found.package.options
            .filter((option) => option.sensitive)
            .map((option) => ({ name: option.key, description: `${option.title}: ${option.description}` }));
          if (entries.length > 0) holders.push({ id, key: id, title: found.package.title ?? found.package.name, entries });
        }
        return holders;
      },
      (effect) =>
        Effect.mapError(
          effect,
          (failure) =>
            new SecretOwnerFailed({
              reason: `The plugins could not be read: ${failure.message}`,
              unblock: ['repeat once the settings store answers'],
            }),
        ),
    ),
    changed: (key) => Effect.andThen(PubSub.publish(values, key), PubSub.publish(pulses, null)).pipe(Effect.asVoid),
  };

  return {
    enabled: EnabledPlugins.of({ of, hooks: hooksOf, held, changes: Stream.fromPubSub(pulses) }),
    hosted: HostedPlugins.of({
      roots,
      root,
      read,
      changes: Stream.merge(Stream.fromPubSub(rebuilds), Stream.fromPubSub(values)),
    }),
    owner,
  };
});
