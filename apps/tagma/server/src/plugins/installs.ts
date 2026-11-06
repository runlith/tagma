import { randomUUID } from 'node:crypto';
import type { CloneFailed, CommitUnreachable } from '@runlith/git/clone';
import { Clock, Duration, Effect, FileSystem, Result, Semaphore } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { SettableScope, SettingKey } from '../platform/contract/wire/setting.js';
import { Projects } from '../projects/contract/service/registry.js';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import { type PluginPackage, PluginRefused, type PluginUnreadable } from './contract/service/format.js';
import { type PluginDescribed, type PluginPrepared, type PluginProcessControl, Plugins } from './contract/service/plugins.js';
import type { PluginPoints } from './contract/service/points.js';
import { componentName } from './contract/wire/names.js';
import type { PluginDeclared, PluginOrigin, PluginProcessRow, PluginRow, PluginSource } from './contract/wire/rows.js';
import {
  installedFrom,
  type PluginInstall,
  pluginsDisabled,
  pluginsEnabled,
  pluginsInstalled,
  pluginsOptions,
} from './contract/wire/settings.js';
import { componentsOf, consentOf } from './consent.js';
import type { Digests } from './digests.js';
import { type Enabling, enablingIn } from './enabling.js';
import { collision, hosted, type NamesCollide, namesOf, type Read } from './reader.js';
import { type Bound, SECRET_KIND, type Shelf } from './shelf.js';
import { cloneRoot, dropStage, fetchSource, sameSource, settle, sourceOf, type SourceUnreadable } from './sources.js';

const READ_PLUGINS = 'read_plugins names what is installed and what each plugin carries';

const KEPT = Duration.hours(24);

type Wanted = { readonly source: PluginSource; readonly origin: PluginOrigin | null; readonly declared: PluginDeclared | null };

type Change = { readonly enabled: boolean; readonly scope: SettableScope };

type Target = { readonly project: { readonly id: number; readonly name: string }; readonly now: boolean };

const willRun = (there: Enabling, id: string, here: boolean, change: Change | 'kept'): boolean => {
  const now = there.running.has(id);
  if (change === 'kept' || (change.scope === 'project' && !here)) return now;
  if (change.scope === 'project') return change.enabled;
  if (change.enabled) return now || here || !there.off.includes(id);
  return there.own.includes(id) && !there.off.includes(id);
};

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

const shownOf = (read: Read, bound: Bound, points: PluginPoints['Service']) => ({
  components: componentsOf(
    bound.loaded,
    new Map(read.package.agents.map((agent) => [componentName(read.id, agent.name), agent.dropped])),
    points.title,
  ),
  ignored: [...read.package.ignored, ...bound.skipped],
  options: optionRows(read.package, bound.options),
});

export const makeInstalls = Effect.fnUntraced(function* (input: {
  readonly shelf: Shelf;
  readonly digests: Digests;
  readonly home: string;
  readonly points: PluginPoints['Service'];
  readonly processes: () => PluginProcessControl;
  readonly changed: (projectId: number | null) => Effect.Effect<void>;
  readonly touched: (id: string) => Effect.Effect<void>;
}) {
  const { shelf, digests, home, points, processes, changed, touched } = input;
  const settings = yield* Settings;
  const projects = yield* Projects;
  const owners = yield* SecretOwners;
  const files = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scope = yield* Effect.scope;
  const serial = yield* Semaphore.make(1);
  const holding = new Map<string, Held>();

  const locked = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> => serial.withPermit(work);

  const enabling = (projectId: number) => enablingIn(settings, projectId);

  const runningAnywhere = Effect.fnUntraced(function* (id: string) {
    for (const project of yield* projects.list()) {
      if ((yield* enabling(project.id)).running.has(id)) return true;
    }
    return false;
  });

  const runsAfter = Effect.fnUntraced(function* (id: string, projectId: number, change: Change | 'kept') {
    const targets: Target[] = [];
    for (const project of yield* projects.list()) {
      const there = yield* enabling(project.id);
      if (willRun(there, id, project.id === projectId, change)) targets.push({ project, now: there.running.has(id) });
    }
    return targets;
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
      Effect.tap((read) => {
        const checked = points.check(read.id, read.package.contributes);
        return Result.isFailure(checked) ? Effect.fail(refusedOf(new PluginRefused({ reason: checked.failure }))) : Effect.void;
      }),
    );

  const processOf = (id: string, pkg: PluginPackage): PluginProcessRow | undefined =>
    hosted(pkg) ? (processes().reading(id) ?? { state: 'stopped', tools: 0, restarts: 0 }) : undefined;

  const outdatedOf = Effect.fnUntraced(function* (root: string, pkg: PluginPackage) {
    const build = pkg.build;
    if (build === null) return false;
    return (yield* digests.digest(root, build.sources, 'sources').pipe(Effect.orDie)) !== build.hash;
  });

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
        ...shownOf(read, bound, points),
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

  const rowOf = Effect.fn('Plugins.rowOf')(function* (install: PluginInstall, projectId: number, enabled: Enabling) {
    const project = yield* projectRoot(projectId);
    const base = {
      id: install.id,
      source: install.source,
      origin: install.origin,
      root: install.root,
      enabled: enabled.running.has(install.id),
      everywhere: enabled.everywhere.has(install.id),
    };
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
        process: processes().reading(install.id),
        outdated: false,
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
      ...shownOf(read, bound, points),
      process: processOf(install.id, pkg),
      outdated: yield* outdatedOf(install.root, pkg),
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
    return yield* rowOf(install, projectId, yield* enabling(projectId));
  });

  const clashes = Effect.fnUntraced(function* (target: Target, read: Read, here: number) {
    const enabled = [...(yield* enabling(target.project.id)).running].filter((id) => id !== read.id);
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
      const where = target.project.id === here ? 'this project' : `project “${target.project.name}”`;
      return yield* new GateRefusal('plugin-names-collide', `In ${where} ${collided}.`, [
        `disable one of the two plugins in ${where}, then enable this one`,
      ]);
    }
  });

  const listed = (key: SettingKey<readonly string[]>, scope: SettableScope, projectId: number | undefined, id: string, present: boolean) =>
    settings.amend<readonly string[], never>(key, scope, projectId, (current) =>
      Effect.succeed(present ? (current.includes(id) ? current : [...current, id]) : current.filter((entry) => entry !== id)),
    );

  const switched = Effect.fnUntraced(function* (projectId: number, id: string, change: Change) {
    const here = yield* enabling(projectId);
    if (change.scope === 'user') {
      if (here.everywhere.has(id) !== change.enabled) yield* listed(pluginsEnabled, 'user', undefined, id, change.enabled);
      if (change.enabled && here.off.includes(id)) yield* listed(pluginsDisabled, 'project', projectId, id, false);
      return;
    }
    if (here.own.includes(id) !== change.enabled) yield* listed(pluginsEnabled, 'project', projectId, id, change.enabled);
    const off = !change.enabled && here.everywhere.has(id);
    if (here.off.includes(id) !== off) yield* listed(pluginsDisabled, 'project', projectId, id, off);
  });

  const recorded = (change: (current: readonly PluginInstall[]) => readonly PluginInstall[]) =>
    settings.amend<readonly PluginInstall[], never>(pluginsInstalled, 'user', undefined, (current) => Effect.succeed(change(current)));

  const put = Effect.fnUntraced(function* (projectId: number, prepared: PluginPrepared, change: Change | 'kept') {
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
    if (change === 'kept') {
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
    const replaces = yield* untaken(id, held);
    yield* Effect.forEach(yield* runsAfter(id, projectId, change), (target) => clashes(target, read, projectId), { discard: true });
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
    if (change !== 'kept') yield* switched(projectId, id, change);
    if (replaces) yield* touched(id);
    yield* changed(null);
    return yield* row(projectId, id);
  });

  return Plugins.of({
    ids: () => Effect.map(installedList, (installs) => installs.map((install) => install.id).sort()),
    installs: () => installedList,
    rows: Effect.fn('Plugins.rows')(function* (projectId, ids) {
      const enabled = yield* enabling(projectId);
      const installs = new Map((yield* installedList).map((install) => [install.id, install]));
      return yield* Effect.forEach(
        ids.flatMap((id) => {
          const install = installs.get(id);
          return install === undefined ? [] : [install];
        }),
        (install) => rowOf(install, projectId, enabled),
      );
    }),
    describe: Effect.fn('Plugins.describe')(function* ({ root, declared }) {
      return yield* shelf.look(root, declared).pipe(
        Effect.map(({ package: pkg }): PluginDescribed => ({
          title: pkg.title,
          description: pkg.description,
          brings: [
            ...(pkg.skills.length > 0 ? (['skill'] as const) : []),
            ...(pkg.commands.length > 0 ? (['command'] as const) : []),
            ...(pkg.servers.length > 0 ? (['mcp-server'] as const) : []),
            ...(pkg.agents.length > 0 ? (['agent'] as const) : []),
            ...(pkg.hooks.length > 0 ? (['hook'] as const) : []),
            ...(pkg.process !== null ? (['process'] as const) : []),
            ...(Object.keys(pkg.contributes).length > 0 ? (['contribution'] as const) : []),
          ],
        })),
        Effect.catchTags({
          PluginRefused: () => Effect.succeed(null),
          PluginUnreadable: () => Effect.succeed(null),
          NamesCollide: () => Effect.succeed(null),
        }),
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
      holding.set(taken.token, taken);
      yield* Effect.forkIn(Effect.delay(expire(taken.token), KEPT), scope);
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
    install: Effect.fn('Plugins.install')(function* ({ projectId, prepared, enabled, scope }) {
      return yield* locked(put(projectId, prepared, { enabled, scope }));
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
    enable: Effect.fn('Plugins.enable')(function* ({ projectId, id, enabled, scope }) {
      return yield* locked(
        Effect.gen(function* () {
          const install = yield* installedOf(id);
          const change = { enabled, scope };
          if (enabled) {
            const read = yield* readOf(install.root, install.declared);
            const starting = (yield* runsAfter(id, projectId, change)).filter((target) => !target.now);
            yield* Effect.forEach(starting, (target) => clashes(target, read, projectId), { discard: true });
          }
          yield* switched(projectId, id, change);
          yield* changed(scope === 'user' ? null : projectId);
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
          if ((yield* enabling(projectId)).everywhere.has(id)) yield* listed(pluginsEnabled, 'user', undefined, id, false);
          for (const project of yield* projects.list()) {
            const there = yield* enabling(project.id);
            if (there.own.includes(id)) yield* listed(pluginsEnabled, 'project', project.id, id, false);
            if (there.off.includes(id)) yield* listed(pluginsDisabled, 'project', project.id, id, false);
          }
          shelf.forget(install.root);
          digests.forget(install.root);
          yield* changed(null);
          yield* processes().stopped(id);
          if (install.root === cloneRoot(home, id)) {
            yield* files
              .remove(install.root, { recursive: true, force: true })
              .pipe(
                Effect.mapError(
                  (failure) =>
                    new GateRefusal(
                      'plugin-clone-failed',
                      `${id} is uninstalled and its process stopped, but its copy at ${install.root} could not be removed: ${failure.message}`,
                      ['remove that folder by hand; installing the plugin again also replaces it'],
                    ),
                ),
              );
          }
          return { ...answer, enabled: false, everywhere: false };
        }),
      );
    }),
  });
});
