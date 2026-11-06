import { Effect, PubSub, Stream } from 'effect';
import { ContributionPoint } from '../platform/contract/service/contribution.js';
import { Projects } from '../projects/contract/service/registry.js';
import { type SecretOwner, SecretOwnerFailed } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import { PluginRefused, PluginUnreadable } from './contract/service/format.js';
import { toolHook } from './contract/service/hooks.js';
import {
  EnabledPlugins,
  HostedPlugins,
  type LoadedHook,
  type PluginHostedRoot,
  type PluginLoaded,
  PluginsUnreadable,
  PluginUnhosted,
} from './contract/service/plugins.js';
import type { PluginContribution, PluginPoints } from './contract/service/points.js';
import { type HookEntries, HOOKS_FACE } from './contract/wire/hooks.js';
import { pluginsDisabled, pluginsEnabled, pluginsInstalled } from './contract/wire/settings.js';
import type { Digests } from './digests.js';
import { enablingIn } from './enabling.js';
import { hosted } from './reader.js';
import { SECRET_KIND, type Shelf } from './shelf.js';

const HOOKS = new ContributionPoint<never, HookEntries>('plugins/hooks', HOOKS_FACE);

export const makeEnabled = Effect.fnUntraced(function* (input: {
  readonly shelf: Shelf;
  readonly digests: Digests;
  readonly points: PluginPoints['Service'];
  readonly pulses: PubSub.PubSub<number | null>;
  readonly inputs: PubSub.PubSub<string>;
}) {
  const { shelf, digests, points, pulses, inputs } = input;
  const settings = yield* Settings;
  const projects = yield* Projects;
  const hooks = yield* points.hold(HOOKS);
  const toolHooks = new WeakMap<PluginContribution<HookEntries>, Map<number, readonly LoadedHook[]>>();

  const hooked = (loaded: PluginLoaded, projectId: number): PluginLoaded => {
    const contribution = hooks.of(loaded.id);
    if (contribution === undefined || contribution.value.length === 0) return loaded;
    let made = toolHooks.get(contribution);
    if (made === undefined) {
      made = new Map();
      toolHooks.set(contribution, made);
    }
    let declared = made.get(projectId);
    if (declared === undefined) {
      const place = { plugin: loaded.id, projectId, caller: contribution.caller };
      declared = contribution.value.map((entry) => toolHook(entry, place));
      made.set(projectId, declared);
    }
    return { ...loaded, hooks: [...loaded.hooks, ...declared] };
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
      loaded.push(hooked((yield* shelf.bind(read, install.root, project).pipe(Effect.mapError(unreadable))).loaded, projectId));
    }
    return loaded;
  });

  const held = Effect.fn('EnabledPlugins.held')(function* (projectId: number) {
    const enabled = yield* settings.held(pluginsEnabled, projectId).pipe(Effect.mapError(unreadable));
    const off = yield* settings.held(pluginsDisabled, projectId).pipe(Effect.mapError(unreadable));
    let seen: { readonly enabled: readonly string[]; readonly off: readonly string[]; readonly running: readonly string[] } | null = null;
    return (): readonly string[] => {
      const now = { enabled: enabled(), off: off() };
      if (seen !== null && seen.enabled === now.enabled && seen.off === now.off) return seen.running;
      seen = { ...now, running: now.enabled.filter((id) => !now.off.includes(id)) };
      return seen.running;
    };
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

  const roots = Effect.fn('HostedPlugins.roots')(function* () {
    const running = yield* anywhere();
    const listed = new Map<string, PluginHostedRoot>();
    for (const install of yield* installs) {
      const there = running.get(install.id);
      if (there === undefined) continue;
      const taken = yield* shelf.read(install.root, install.declared ?? null).pipe(
        Effect.map((found) => hosted(found.package)),
        Effect.catchTags({
          PluginRefused: () => Effect.succeed(true),
          PluginUnreadable: () => Effect.succeed(true),
          NamesCollide: () => Effect.succeed(true),
        }),
      );
      if (taken) listed.set(install.id, { root: install.root, projects: there.sort((a, b) => a - b) });
    }
    return listed;
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
    const revision = yield* digests.digest(install.root, outputs, 'outputs').pipe(Effect.mapError(unreadable));
    if (revision === null) {
      return yield* new PluginUnreadable({ path: install.root, reason: `${outputs.join(' or ')} went missing while it was read` });
    }
    const processRevision =
      pkg.process === null ? null : yield* digests.digest(install.root, [pkg.process.entry], 'process').pipe(Effect.mapError(unreadable));
    return {
      id,
      title: pkg.title ?? pkg.name,
      root: install.root,
      data: shelf.data(id),
      revision,
      processRevision,
      outputs,
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
        const enabled = (yield* enablingIn(settings, projectId)).running;
        const installed = yield* settings.value(pluginsInstalled);
        const holders = [];
        for (const id of enabled) {
          const install = installed.find((entry) => entry.id === id);
          if (install === undefined) continue;
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
    changed: (key) => Effect.andThen(PubSub.publish(inputs, key), PubSub.publish(pulses, null)).pipe(Effect.asVoid),
  };

  return {
    enabled: EnabledPlugins.of({ of, held, changes: Stream.fromPubSub(pulses) }),
    hosted: HostedPlugins.of({ roots, read, changes: Stream.fromPubSub(inputs) }),
    owner,
  };
});
