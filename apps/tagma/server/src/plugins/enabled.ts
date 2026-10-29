import { Effect, PubSub, Stream } from 'effect';
import { Projects } from '../projects/contract/service/registry.js';
import { type SecretOwner, SecretOwnerFailed } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import { EnabledPlugins, type PluginLoaded, PluginsUnreadable } from './contract/service/plugins.js';
import { pluginsEnabled, pluginsInstalled } from './contract/wire/settings.js';
import { SECRET_KIND, type Shelf } from './shelf.js';

export const makeEnabled = Effect.fnUntraced(function* (input: { readonly shelf: Shelf; readonly pulses: PubSub.PubSub<number | null> }) {
  const { shelf, pulses } = input;
  const settings = yield* Settings;
  const projects = yield* Projects;

  const unreadable = (failure: { readonly message: string }) => new PluginsUnreadable({ reason: failure.message });

  const refusedHere = (id: string) => (refused: { readonly message: string }) =>
    Effect.as(Effect.logWarning(`the plugin ${id} contributes nothing while its directory is refused: ${refused.message}`), null);

  const of = Effect.fn('EnabledPlugins.of')(function* (projectId: number) {
    const enabled = yield* settings.value(pluginsEnabled, projectId).pipe(Effect.mapError(unreadable));
    if (enabled.length === 0) return [] as readonly PluginLoaded[];
    const installs = yield* settings.value(pluginsInstalled).pipe(Effect.mapError(unreadable));
    const project = (yield* projects.byId(projectId).pipe(Effect.mapError(unreadable))).rootPath;
    const loaded: PluginLoaded[] = [];
    for (const id of enabled) {
      const install = installs.find((entry) => entry.id === id);
      if (install === undefined) continue;
      const bound = yield* Effect.flatMap(shelf.read(install.root), (read) => shelf.bind(read, install.root, project)).pipe(
        Effect.catchTags({ PluginRefused: refusedHere(id), NamesCollide: refusedHere(id) }),
        Effect.mapError(unreadable),
      );
      if (bound !== null) loaded.push(bound.loaded);
    }
    return loaded;
  });

  const owner: SecretOwner = {
    kind: SECRET_KIND,
    holders: Effect.fn('EnabledPlugins.holders')(
      function* (projectId: number) {
        const enabled = yield* settings.value(pluginsEnabled, projectId);
        const installs = yield* settings.value(pluginsInstalled);
        const holders = [];
        for (const id of enabled) {
          const install = installs.find((entry) => entry.id === id);
          if (install === undefined) continue;
          const read = yield* shelf
            .read(install.root)
            .pipe(Effect.catchTags({ PluginRefused: refusedHere(id), NamesCollide: refusedHere(id) }));
          if (read === null) continue;
          const entries = read.package.options
            .filter((option) => option.sensitive)
            .map((option) => ({ name: option.key, description: `${option.title}: ${option.description}` }));
          if (entries.length > 0) holders.push({ id, key: id, title: read.package.title ?? read.package.name, entries });
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
    changed: () => Effect.asVoid(PubSub.publish(pulses, null)),
  };

  return { enabled: EnabledPlugins.of({ of, changes: Stream.fromPubSub(pulses) }), owner };
});
