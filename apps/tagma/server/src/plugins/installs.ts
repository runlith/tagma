import { randomUUID } from 'node:crypto';
import type { CloneFailed, CommitUnreachable } from '@runlith/git/clone';
import { Clock, Duration, Effect, FileSystem, Semaphore } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Projects } from '../projects/contract/service/registry.js';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import type { PluginPackage, PluginRefused, PluginUnreadable } from './contract/service/format.js';
import { type PluginPrepared, Plugins } from './contract/service/plugins.js';
import { componentName } from './contract/wire/names.js';
import type { PluginDeclared, PluginOrigin, PluginRow, PluginSource } from './contract/wire/rows.js';
import { installedFrom, type PluginInstall, pluginsEnabled, pluginsInstalled, pluginsOptions } from './contract/wire/settings.js';
import { componentsOf, consentOf } from './consent.js';
import { collision, type NamesCollide, namesOf, type Read } from './reader.js';
import { type Bound, SECRET_KIND, type Shelf } from './shelf.js';
import { cloneRoot, dropStage, fetchSource, sameSource, settle, sourceOf, type SourceUnreadable } from './sources.js';

const READ_PLUGINS = 'read_plugins names what is installed and what each plugin carries';

const KEPT = Duration.hours(24);

type Wanted = { readonly source: PluginSource; readonly origin: PluginOrigin | null; readonly declared: PluginDeclared | null };

type Held = Wanted & {
  readonly token: string;
  readonly fetched: PluginSource;
  readonly root: string;
  readonly stage: string | null;
  readonly expires: number;
};

const refusedOf = (failure: PluginRefused | PluginUnreadable | NamesCollide) =>
  failure._tag === 'NamesCollide'
    ? new GateRefusal('plugin-names-collide', failure.reason, ['rename one of the two components in the plugin, then install again'])
    : new GateRefusal('plugin-refused', failure.message, ['correct the plugin as the reason says, then install again']);

const unfetchedOf = (failure: SourceUnreadable | CloneFailed | CommitUnreachable) => {
  switch (failure._tag) {
    case 'SourceUnreadable':
      return new GateRefusal('plugin-source-unreadable', failure.reason, ['name a plugin directory the server can read, or a git URL']);
    case 'CloneFailed':
      return new GateRefusal('plugin-clone-failed', failure.message, [
        'check the URL and that git can reach it as the operator, then install again',
      ]);
    case 'CommitUnreachable':
      return new GateRefusal('plugin-pin-unreachable', failure.message, [
        'the source pins a commit its repository no longer serves: install a revision it serves',
      ]);
  }
};

const sameOrigin = (a: PluginOrigin | null, b: PluginOrigin | null): boolean =>
  a !== null && b !== null && a.marketplace === b.marketplace && a.entry === b.entry;

const sameInstall = (standing: PluginInstall, wanted: Wanted): boolean =>
  standing.origin !== undefined || wanted.origin !== null
    ? sameOrigin(standing.origin ?? null, wanted.origin)
    : sameSource(standing.source, wanted.source);

const optionRows = (pkg: PluginPackage, values: Readonly<Record<string, string>>) =>
  pkg.options.map((option) => ({
    key: option.key,
    type: option.type,
    title: option.title,
    description: option.description,
    sensitive: option.sensitive,
    required: option.required,
    set: values[option.key] !== undefined,
    fallback: option.sensitive ? null : option.fallback,
  }));

const shownOf = (read: Read, bound: Bound) => ({
  components: componentsOf(bound.loaded, new Map(read.package.agents.map((agent) => [componentName(read.id, agent.name), agent.dropped]))),
  ignored: [...read.package.ignored, ...bound.skipped],
  options: optionRows(read.package, bound.options),
});

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
  const scope = yield* Effect.scope;
  const serial = yield* Semaphore.make(1);
  const holding = new Map<string, Held>();

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

  const readOf = (root: string, declared: PluginDeclared | null | undefined) =>
    shelf.read(root, declared ?? null).pipe(
      Effect.catchTags({
        PluginRefused: (failure) => Effect.fail(refusedOf(failure)),
        PluginUnreadable: (failure) => Effect.fail(refusedOf(failure)),
        NamesCollide: (failure) => Effect.fail(refusedOf(failure)),
      }),
    );

  const boundOf = Effect.fnUntraced(function* (read: Read, root: string, projectId: number) {
    return yield* shelf
      .bind(read, root, yield* projectRoot(projectId))
      .pipe(Effect.catchTag('PluginUnreadable', (failure) => Effect.fail(refusedOf(failure))));
  });

  const installedList = settings.value(pluginsInstalled);

  const untaken = Effect.fnUntraced(function* (id: string, wanted: Wanted) {
    const standing = (yield* installedList).find((entry) => entry.id === id);
    if (standing === undefined || sameInstall(standing, wanted)) return standing !== undefined;
    return yield* new GateRefusal('plugin-id-taken', `A plugin named ${id} is already installed from ${installedFrom(standing)}.`, [
      `uninstall_plugin ${id}, then install this one`,
    ]);
  });

  const preparedOf = Effect.fnUntraced(function* (held: Held, read: Read, projectId: number) {
    const bound = yield* boundOf(read, held.root, projectId);
    const consent = consentOf(bound.loaded);
    const pkg = read.package;
    return {
      id: read.id,
      consent,
      running: yield* runningAnywhere(read.id),
      token: held.token,
      format: read.format,
      source: held.fetched,
      origin: held.origin,
      declared: held.declared,
      root: held.root,
      stage: held.stage,
      package: pkg,
      preview: {
        prepared: held.token,
        expires: new Date(held.expires).toISOString(),
        id: read.id,
        title: pkg.title ?? pkg.name,
        version: pkg.version,
        description: pkg.description,
        format: read.format,
        about: pkg.about,
        source: held.fetched,
        origin: held.origin ?? undefined,
        replaces: yield* untaken(read.id, held),
        ...shownOf(read, bound),
        consent: {
          runs: consent.subjects.filter((subject) => subject.kind === 'execute').map((subject) => subject.value),
          reaches: consent.subjects.filter((subject) => subject.kind === 'network').map((subject) => subject.value),
          raises: consent.raised.map((raised) => raised.fact),
        },
      },
    } satisfies PluginPrepared;
  });

  const expired = (token: string) =>
    new GateRefusal(
      'plugin-preview-expired',
      `No prepared plugin ${token} is held: it was installed, or dropped after a day or a server restart.`,
      ['prepare it again — preview_plugin for a marketplace entry, install_plugin for a folder or git URL — and install what that answers'],
    );

  const expire = (token: string) =>
    locked(
      Effect.gen(function* () {
        const held = holding.get(token);
        if (held === undefined) return;
        holding.delete(token);
        shelf.forget(held.root);
        if (held.stage !== null) yield* dropStage(held.stage).pipe(Effect.provideService(FileSystem.FileSystem, files));
      }),
    ).pipe(Effect.tapError((failure) => Effect.logWarning(`a dropped plugin preview could not be removed: ${failure.message}`)));

  const fetched = Effect.fnUntraced(function* (wanted: Wanted) {
    const got = yield* fetchSource(wanted.source, home, wanted.origin !== null).pipe(
      Effect.provideService(FileSystem.FileSystem, files),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.mapError(unfetchedOf),
    );
    shelf.forget(got.root);
    return {
      ...wanted,
      token: randomUUID(),
      fetched: got.source,
      root: got.root,
      stage: got.stage,
      expires: (yield* Clock.currentTimeMillis) + Duration.toMillis(KEPT),
    } satisfies Held;
  });

  const dropped = (taken: Held) =>
    taken.stage === null
      ? Effect.void
      : Effect.andThen(
          Effect.sync(() => shelf.forget(taken.root)),
          Effect.orDie(dropStage(taken.stage).pipe(Effect.provideService(FileSystem.FileSystem, files))),
        );

  const rowOf = Effect.fn('Plugins.rowOf')(function* (install: PluginInstall, projectId: number, enabled: ReadonlySet<string>) {
    const project = yield* projectRoot(projectId);
    const base = { id: install.id, source: install.source, origin: install.origin, root: install.root, enabled: enabled.has(install.id) };
    const reading = yield* Effect.result(
      Effect.flatMap(shelf.read(install.root, install.declared ?? null), (read) =>
        Effect.map(shelf.bind(read, install.root, project), (bound) => ({ read, bound })),
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
    const { read, bound } = reading.success;
    const pkg = read.package;
    return {
      ...base,
      title: pkg.title ?? pkg.name,
      version: pkg.version,
      description: pkg.description,
      format: read.format,
      ...shownOf(read, bound),
    } satisfies PluginRow;
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

  const row = Effect.fnUntraced(function* (projectId: number, id: string) {
    const install = yield* installedOf(id);
    return yield* rowOf(install, projectId, new Set(yield* settings.value(pluginsEnabled, projectId)));
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

  const put = Effect.fnUntraced(function* (projectId: number, prepared: PluginPrepared, enabled: boolean | 'kept') {
    const { id } = prepared;
    const held: Held | undefined =
      prepared.stage === null
        ? {
            token: prepared.token,
            source: prepared.source,
            fetched: prepared.source,
            origin: prepared.origin,
            declared: prepared.declared,
            root: prepared.root,
            stage: null,
            expires: 0,
          }
        : holding.get(prepared.token);
    if (held === undefined) return yield* expired(prepared.token);
    if (enabled === 'kept') {
      const standing = (yield* installedList).find((entry) => entry.id === id);
      if (standing === undefined || !sameOrigin(standing.origin ?? null, held.origin)) {
        return yield* new GateRefusal('plugin-not-installed', `${id} was uninstalled while its update waited, so nothing is updated.`, [
          'install it from its marketplace entry again',
        ]);
      }
    }
    shelf.forget(held.root);
    const read = yield* readOf(held.root, held.declared);
    if (read.id !== id) {
      return yield* new GateRefusal(
        'plugin-refused',
        `The plugin at ${held.root} now names itself ${read.id}, not ${id}, which was approved.`,
        ['install again'],
      );
    }
    yield* untaken(id, held);
    const enabledHere = (yield* settings.value(pluginsEnabled, projectId)).includes(id);
    const runs = enabled === 'kept' ? enabledHere : enabled;
    const running: number[] = runs ? [projectId] : [];
    for (const project of yield* projects.list()) {
      if (project.id !== projectId && (yield* settings.value(pluginsEnabled, project.id)).includes(id)) running.push(project.id);
    }
    yield* Effect.forEach(running, (project) => clashes(project, read), { discard: true });
    const stage = held.stage;
    const root =
      stage === null
        ? held.root
        : yield* settle({ root: held.root, stage }, cloneRoot(home, id)).pipe(
            Effect.provideService(FileSystem.FileSystem, files),
            Effect.mapError(
              (failure) =>
                new GateRefusal('plugin-clone-failed', `The plugin could not be put in place: ${failure.message}`, ['install again']),
            ),
          );
    holding.delete(prepared.token);
    shelf.forget(held.root);
    shelf.forget(root);
    yield* recorded((current) => [
      ...current.filter((entry) => entry.id !== id),
      { id, source: held.fetched, root, origin: held.origin ?? undefined, declared: held.declared ?? undefined },
    ]);
    if (runs !== enabledHere) yield* shown(projectId, id, runs);
    yield* changed(null);
    return yield* row(projectId, id);
  });

  return Plugins.of({
    ids: () => Effect.map(installedList, (installs) => installs.map((install) => install.id).sort()),
    installs: () => installedList,
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
      const wanted: Wanted =
        typeof given === 'string'
          ? { source: sourceOf(given, yield* projectRoot(projectId)), origin: null, declared: null }
          : { source: given.source, origin: given.origin, declared: given.declared };
      const taken = yield* fetched(wanted);
      const prepared = yield* Effect.flatMap(readOf(taken.root, taken.declared), (read) => preparedOf(taken, read, projectId)).pipe(
        Effect.tapError(() => dropped(taken)),
      );
      if (taken.stage !== null) {
        holding.set(taken.token, taken);
        yield* Effect.forkIn(Effect.delay(expire(taken.token), KEPT), scope);
      }
      return prepared;
    }),
    held: Effect.fn('Plugins.held')(function* ({ projectId, token }) {
      return yield* locked(
        Effect.gen(function* () {
          const held = holding.get(token);
          if (held === undefined) return yield* expired(token);
          return yield* preparedOf(held, yield* readOf(held.root, held.declared), projectId);
        }),
      );
    }),
    install: Effect.fn('Plugins.install')(function* ({ projectId, prepared, enabled }) {
      return yield* locked(put(projectId, prepared, enabled));
    }),
    update: Effect.fn('Plugins.update')(function* ({ projectId, prepared }) {
      return yield* locked(put(projectId, prepared, 'kept'));
    }),
    installed: Effect.fn('Plugins.installed')(function* ({ projectId, id }) {
      const install = yield* installedOf(id);
      const read = yield* readOf(install.root, install.declared);
      const bound = yield* boundOf(read, install.root, projectId);
      return { id: read.id, consent: consentOf(bound.loaded), running: yield* runningAnywhere(read.id) };
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
          if (install.root === cloneRoot(home, id)) {
            yield* files
              .remove(install.root, { recursive: true, force: true })
              .pipe(
                Effect.mapError(
                  (failure) =>
                    new GateRefusal(
                      'plugin-clone-failed',
                      `${id} stays installed: its copy at ${install.root} could not be removed: ${failure.message}`,
                      ['make the copy writable to the server, then uninstall again'],
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
