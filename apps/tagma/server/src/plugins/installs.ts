import { Effect, FileSystem, Semaphore } from 'effect';
import { componentName } from './contract/wire/names.js';
import { ChildProcessSpawner } from 'effect/process';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Projects } from '../projects/contract/service/registry.js';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import type { PluginRefused, PluginUnreadable } from './contract/service/format.js';
import { type PluginPrepared, Plugins } from './contract/service/plugins.js';
import type { PluginRow } from './contract/wire/rows.js';
import { type PluginInstall, pluginsEnabled, pluginsInstalled, pluginsOptions } from './contract/wire/settings.js';
import { componentsOf, consentOf } from './consent.js';
import { collision, type NamesCollide, namesOf, type Read } from './reader.js';
import { SECRET_KIND, type Shelf } from './shelf.js';
import { type CloneFailed, fetchSource, sameSource, settleClone, sourceOf, type SourceUnreadable } from './sources.js';

const READ_PLUGINS = 'read_plugins names what is installed and what each plugin carries';

const refusedOf = (failure: PluginRefused | PluginUnreadable | NamesCollide | SourceUnreadable | CloneFailed) => {
  switch (failure._tag) {
    case 'NamesCollide':
      return new GateRefusal('plugin-names-collide', failure.reason, [
        'rename one of the two components in the plugin, then install again',
      ]);
    case 'SourceUnreadable':
      return new GateRefusal('plugin-source-unreadable', failure.reason, ['name a plugin directory the server can read, or a git URL']);
    case 'CloneFailed':
      return new GateRefusal('plugin-clone-failed', failure.reason, [
        'check the URL and that git can reach it as the operator, then install again',
      ]);
    default:
      return new GateRefusal('plugin-refused', failure.message, ['correct the plugin as the reason says, then install again']);
  }
};

export const makeInstalls = Effect.fnUntraced(function* (input: {
  readonly shelf: Shelf;
  readonly home: string;
  readonly changed: (projectId: number | null) => Effect.Effect<void>;
}) {
  const { shelf, home, changed } = input;
  const settings = yield* Settings;
  const projects = yield* Projects;
  const owners = yield* SecretOwners;
  const files = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serial = yield* Semaphore.make(1);

  const locked = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> => serial.withPermit(work);

  const runningAnywhere = Effect.fnUntraced(function* (id: string) {
    for (const project of yield* projects.list()) {
      if ((yield* settings.value(pluginsEnabled, project.id)).includes(id)) return true;
    }
    return false;
  });

  const projectRoot = (projectId: number) =>
    Effect.map(
      projects
        .byId(projectId)
        .pipe(
          Effect.mapError(
            () =>
              new GateRefusal('unknown-project', `No project ${projectId} is registered.`, ['list_projects names the registered projects']),
          ),
        ),
      (project) => project.rootPath,
    );

  const readOf = (root: string, declared: PluginInstall['declared']) =>
    shelf.read(root, declared ?? null).pipe(
      Effect.catchTags({
        PluginRefused: (failure) => Effect.fail(refusedOf(failure)),
        PluginUnreadable: (failure) => Effect.fail(refusedOf(failure)),
        NamesCollide: (failure) => Effect.fail(refusedOf(failure)),
      }),
    );

  const preparedOf = Effect.fnUntraced(function* (read: Read, root: string, source: PluginInstall['source'], projectId: number) {
    const { loaded } = yield* shelf
      .bind(read, root, yield* projectRoot(projectId))
      .pipe(Effect.catchTag('PluginUnreadable', (failure) => Effect.fail(refusedOf(failure))));
    return {
      id: read.id,
      format: read.format,
      source,
      root,
      package: read.package,
      consent: consentOf(loaded),
      running: yield* runningAnywhere(read.id),
    } satisfies PluginPrepared;
  });

  const installedList = settings.value(pluginsInstalled);

  const rowOf = Effect.fn('Plugins.rowOf')(function* (install: PluginInstall, projectId: number, enabled: ReadonlySet<string>) {
    const project = yield* projectRoot(projectId);
    const base = { id: install.id, source: install.source, root: install.root, enabled: enabled.has(install.id) };
    const reading = yield* Effect.result(
      Effect.flatMap(shelf.read(install.root, install.declared ?? null), (read) =>
        Effect.map(shelf.bind(read, install.root, project), (bound) => ({ read, ...bound })),
      ),
    );
    if (reading._tag === 'Failure') {
      return {
        ...base,
        title: null,
        version: null,
        description: null,
        format: null,
        components: [],
        ignored: [],
        options: [],
        refused: reading.failure.message,
      } satisfies PluginRow;
    }
    const { read, loaded, options, skipped } = reading.success;
    const pkg = read.package;
    const dropped = new Map(pkg.agents.map((agent) => [componentName(install.id, agent.name), agent.dropped]));
    return {
      ...base,
      title: pkg.title ?? pkg.name,
      version: pkg.version,
      description: pkg.description,
      format: read.format,
      components: componentsOf(loaded, dropped),
      ignored: [...pkg.ignored, ...skipped],
      options: pkg.options.map((option) => ({
        key: option.key,
        type: option.type,
        title: option.title,
        description: option.description,
        sensitive: option.sensitive,
        required: option.required,
        set: options[option.key] !== undefined,
        fallback: option.sensitive ? null : option.fallback,
      })),
    } satisfies PluginRow;
  });

  const row = Effect.fnUntraced(function* (projectId: number, id: string) {
    const install = (yield* installedList).find((entry) => entry.id === id);
    const enabled = new Set(yield* settings.value(pluginsEnabled, projectId));
    if (install === undefined) return yield* notInstalled(id);
    return yield* rowOf(install, projectId, enabled);
  });

  const notInstalled = (id: string) =>
    Effect.fail(
      new GateRefusal('plugin-not-installed', `The plugin ${id} is not installed on this machine.`, [
        `install_plugin from its folder or git URL first`,
        READ_PLUGINS,
      ]),
    );

  const installedOf = Effect.fnUntraced(function* (id: string) {
    const install = (yield* installedList).find((entry) => entry.id === id);
    return install ?? (yield* notInstalled(id));
  });

  const clashes = Effect.fnUntraced(function* (projectId: number, read: Read) {
    const enabled = (yield* settings.value(pluginsEnabled, projectId)).filter((id) => id !== read.id);
    const installs = yield* installedList;
    const others = [];
    for (const id of enabled) {
      const install = installs.find((entry) => entry.id === id);
      if (install === undefined) continue;
      const standing = yield* shelf.read(install.root, install.declared ?? null).pipe(
        Effect.catchTags({
          PluginRefused: () => Effect.succeed(null),
          PluginUnreadable: () => Effect.succeed(null),
          NamesCollide: () => Effect.succeed(null),
        }),
      );
      if (standing !== null)
        others.push(...namesOf(standing.id, standing.package).map((named) => ({ ...named, from: `${id}'s ${named.from}` })));
    }
    const collided = collision([
      ...others,
      ...namesOf(read.id, read.package).map((named) => ({ ...named, from: `${read.id}'s ${named.from}` })),
    ]);
    if (collided !== null) {
      return yield* new GateRefusal('plugin-names-collide', `In this project ${collided}.`, [
        'disable one of the two plugins here, then enable this one',
      ]);
    }
  });

  const shown = (projectId: number, id: string, enabled: boolean) =>
    settings.amend<readonly string[], never>(pluginsEnabled, 'project', projectId, (current) =>
      Effect.succeed(enabled ? (current.includes(id) ? current : [...current, id]) : current.filter((entry) => entry !== id)),
    );

  const recorded = (change: (current: readonly PluginInstall[]) => readonly PluginInstall[]) =>
    settings.amend<readonly PluginInstall[], never>(pluginsInstalled, 'user', undefined, (current) => Effect.succeed(change(current)));

  return Plugins.of({
    ids: () => Effect.map(installedList, (installs) => installs.map((install) => install.id).sort()),
    rows: Effect.fn('Plugins.rows')(function* (projectId, ids) {
      const enabled = new Set(yield* settings.value(pluginsEnabled, projectId));
      const installs = new Map((yield* installedList).map((install) => [install.id, install]));
      return yield* Effect.forEach(
        ids.flatMap((id) => {
          const install = installs.get(id);
          return install === undefined ? [] : [install];
        }),
        (install) => rowOf(install, projectId, enabled),
      );
    }),
    prepare: Effect.fn('Plugins.prepare')(function* ({ projectId, source: given }) {
      const source = sourceOf(given, yield* projectRoot(projectId));
      const fetched = yield* fetchSource(source, home).pipe(
        Effect.provideService(FileSystem.FileSystem, files),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.mapError(refusedOf),
      );
      shelf.forget(fetched.root);
      const read = yield* readOf(fetched.root, undefined);
      const standing = (yield* installedList).find((entry) => entry.id === read.id);
      if (standing !== undefined && !sameSource(standing.source, source)) {
        const from = standing.source.kind === 'git' ? standing.source.url : standing.source.path;
        return yield* new GateRefusal('plugin-id-taken', `A plugin named ${read.id} is already installed from ${from}.`, [
          `uninstall_plugin ${read.id}, then install this one`,
        ]);
      }
      return yield* preparedOf(read, fetched.root, source, projectId);
    }),
    install: Effect.fn('Plugins.install')(function* ({ projectId, prepared, enabled }) {
      const { id, source } = prepared;
      return yield* locked(
        Effect.gen(function* () {
          shelf.forget(prepared.root);
          const read = yield* readOf(prepared.root, undefined);
          if (read.id !== id) {
            return yield* new GateRefusal(
              'plugin-refused',
              `The plugin at ${prepared.root} now names itself ${read.id}, not ${id}, which was approved.`,
              ['install again'],
            );
          }
          const standing = (yield* installedList).find((entry) => entry.id === id);
          if (standing !== undefined && !sameSource(standing.source, source)) {
            return yield* new GateRefusal('plugin-id-taken', `A plugin named ${id} was installed from another source meanwhile.`, [
              `uninstall_plugin ${id}, then install this one`,
            ]);
          }
          const enabledHere = (yield* settings.value(pluginsEnabled, projectId)).includes(id);
          const running: number[] = enabled ? [projectId] : [];
          for (const project of yield* projects.list()) {
            if (project.id !== projectId && (yield* settings.value(pluginsEnabled, project.id)).includes(id)) running.push(project.id);
          }
          yield* Effect.forEach(running, (project) => clashes(project, read), { discard: true });
          const root =
            source.kind === 'git'
              ? yield* settleClone(prepared.root, home, id).pipe(
                  Effect.provideService(FileSystem.FileSystem, files),
                  Effect.mapError(
                    (failure) =>
                      new GateRefusal('plugin-clone-failed', `The clone could not be put in place: ${failure.message}`, ['install again']),
                  ),
                )
              : prepared.root;
          shelf.forget(root);
          yield* recorded((current) => [...current.filter((entry) => entry.id !== id), { id, source, root }]);
          if (enabled !== enabledHere) yield* shown(projectId, id, enabled);
          yield* changed(null);
          return yield* row(projectId, id);
        }),
      );
    }),
    installed: Effect.fn('Plugins.installed')(function* ({ projectId, id }) {
      const install = yield* installedOf(id);
      return yield* preparedOf(yield* readOf(install.root, install.declared), install.root, install.source, projectId);
    }),
    enable: Effect.fn('Plugins.enable')(function* ({ projectId, id, enabled }) {
      return yield* locked(
        Effect.gen(function* () {
          const install = yield* installedOf(id);
          if (enabled) yield* clashes(projectId, yield* readOf(install.root, install.declared));
          yield* shown(projectId, id, enabled);
          yield* changed(projectId);
          return yield* row(projectId, id);
        }),
      );
    }),
    uninstall: Effect.fn('Plugins.uninstall')(function* ({ projectId, id }) {
      return yield* locked(
        Effect.gen(function* () {
          const install = yield* installedOf(id);
          const answer = yield* row(projectId, id);
          yield* owners
            .drop(SECRET_KIND, id)
            .pipe(
              Effect.mapError(
                () =>
                  new GateRefusal('secret-store-failed', `${id} stays installed: its secret options could not be dropped.`, [
                    'make secrets.json in the server’s data directory readable and writable to the server, then uninstall again',
                  ]),
              ),
            );
          if (install.source.kind === 'git') {
            yield* files
              .remove(install.root, { recursive: true, force: true })
              .pipe(
                Effect.mapError(
                  (failure) =>
                    new GateRefusal(
                      'plugin-clone-failed',
                      `${id} stays installed: its clone at ${install.root} could not be removed: ${failure.message}`,
                      ['make the clone writable to the server, then uninstall again'],
                    ),
                ),
              );
          }
          yield* recorded((current) => current.filter((entry) => entry.id !== id));
          yield* settings.amend<Readonly<Record<string, Readonly<Record<string, string>>>>, never>(
            pluginsOptions,
            'user',
            undefined,
            (current) => {
              const { [id]: _dropped, ...kept } = current;
              return Effect.succeed(kept);
            },
          );
          for (const project of yield* projects.list()) {
            if ((yield* settings.value(pluginsEnabled, project.id)).includes(id)) yield* shown(project.id, id, false);
          }
          shelf.forget(install.root);
          yield* changed(null);
          return { ...answer, enabled: false };
        }),
      );
    }),
  });
});
