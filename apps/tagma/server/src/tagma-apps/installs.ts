import { join } from 'node:path';
import { Effect, Result, Semaphore } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Projects } from '../projects/contract/service/registry.js';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import { TagmaAppPlace, TagmaApps, type TagmaAppSwitch } from './contract/service/supervision.js';
import { MANIFEST_FILE } from './contract/wire/manifest.js';
import { type TagmaAppInstall, tagmaAppsEnabled, tagmaAppsInstalled } from './contract/wire/settings.js';
import { discover, type Found, manifestOf, PERSONAL_APPS, PROJECT_APPS } from './discovery.js';
import type { PointRegistry } from './registry.js';
import { SECRET_KIND } from './secrets.js';
import { clipped, type Supervisor } from './supervisor.js';

type Standing = { readonly title: string | null; readonly refused: string | null };

const standingOf = (registry: PointRegistry, root: string, id: string) =>
  Effect.match(manifestOf(root), {
    onFailure: (failure): Standing => ({ title: null, refused: failure.reason }),
    onSuccess: (manifest): Standing => {
      const checked = registry.check(id, manifest.contributes);
      return { title: manifest.title, refused: Result.isFailure(checked) ? `${join(root, MANIFEST_FILE)}: ${checked.failure}` : null };
    },
  });

const collision = (id: string, found: readonly Found[]) =>
  new GateRefusal('app-collision', `The app ${id} stands both in ${found.map((entry) => entry.root).join(' and in ')}.`, [
    'remove or rename one of them, then install again',
  ]);

export const makeInstalls = Effect.fnUntraced(function* (input: { readonly registry: PointRegistry; readonly supervisor: Supervisor }) {
  const { registry, supervisor } = input;
  const settings = yield* Settings;
  const projects = yield* Projects;
  const secrets = yield* SecretOwners;
  const { home } = yield* TagmaAppPlace;
  const locks = new Map<string, Semaphore.Semaphore>();

  const found = Effect.fnUntraced(function* (projectId: number) {
    const project = yield* projects.byId(projectId);
    return yield* discover(project.rootPath, home).pipe(
      Effect.mapError(
        (failure) =>
          new GateRefusal('app-floor-unreadable', `${failure.at} could not be read: ${failure.reason}`, [
            'make that directory readable to the server, then read again',
          ]),
      ),
    );
  });

  const rowOf = Effect.fn('Installs.rowOf')(function* (
    id: string,
    found: readonly Found[],
    install: TagmaAppInstall | undefined,
    enabled: boolean,
  ) {
    const root = install?.source ?? found[0]?.root ?? '';
    const reading = supervisor.reading(id);
    const standing: Standing =
      reading === undefined ? yield* standingOf(registry, root, id) : { title: reading.title, refused: reading.refused ?? null };
    const refused = found.length > 1 ? collision(id, found).reason : standing.refused;
    return {
      id,
      title: standing.title,
      root,
      floor: found.find((entry) => entry.root === root)?.floor ?? null,
      installed: install === undefined ? null : { source: install.source, enabled: install.enabled },
      enabled,
      state: reading?.state ?? 'stopped',
      tools: reading?.tools ?? 0,
      restarts: reading?.restarts ?? 0,
      failure: reading?.failure,
      refused: refused === null ? undefined : clipped(refused),
    };
  });

  const row = Effect.fnUntraced(function* (projectId: number, id: string) {
    const candidates = (yield* found(projectId)).filter((entry) => entry.id === id);
    const install = (yield* settings.value(tagmaAppsInstalled)).find((entry) => entry.id === id);
    const enabled = (yield* settings.value(tagmaAppsEnabled, projectId)).includes(id);
    return yield* rowOf(id, candidates, install, enabled);
  });

  const locked = <A, E>(id: string, work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.suspend(() => {
      const lock = locks.get(id) ?? Semaphore.makeUnsafe(1);
      locks.set(id, lock);
      return lock.withPermit(work);
    });

  const installs = (change: (current: readonly TagmaAppInstall[]) => readonly TagmaAppInstall[]) =>
    settings.amend<readonly TagmaAppInstall[], never>(tagmaAppsInstalled, 'user', undefined, (current) => Effect.succeed(change(current)));

  const shown = (projectId: number, id: string, enabled: boolean) =>
    settings.amend<readonly string[], never>(tagmaAppsEnabled, 'project', projectId, (current) =>
      Effect.succeed(enabled ? (current.includes(id) ? current : [...current, id]) : current.filter((entry) => entry !== id)),
    );

  const installed = Effect.fnUntraced(function* (id: string) {
    const standing = (yield* settings.value(tagmaAppsInstalled)).find((install) => install.id === id);
    if (standing === undefined)
      return yield* new GateRefusal('app-not-installed', `The app ${id} is not installed on this machine.`, [
        `install_app ${id} first`,
        'read_apps names what is installed',
      ]);
    return standing;
  });

  const installing = Effect.fnUntraced(function* (input: TagmaAppSwitch) {
    const { id, projectId } = input;
    const candidates = (yield* found(projectId)).filter((entry) => entry.id === id);
    if (candidates.length > 1) return yield* collision(id, candidates);
    const standing = (yield* settings.value(tagmaAppsInstalled)).find((install) => install.id === id);
    const source = candidates[0]?.root ?? standing?.source;
    if (source === undefined)
      return yield* new GateRefusal(
        'app-unknown',
        `No directory ${id} stands in this project's ${PROJECT_APPS} or in the operator's ${PERSONAL_APPS}.`,
        [
          `write the app into ${PROJECT_APPS}/${id}/ with its ${MANIFEST_FILE}, then install it`,
          'read_apps names the apps this project finds',
        ],
      );
    if (standing !== undefined && standing.source !== source)
      return yield* new GateRefusal(
        'app-source-taken',
        `The app ${id} is installed from ${standing.source}; this project finds another at ${source}.`,
        [`uninstall_app ${id}, then install this one`, 'or rename this one'],
      );
    const { refused } = yield* standingOf(registry, source, id);
    if (refused !== null)
      return yield* new GateRefusal('app-refused', refused, [
        `correct ${MANIFEST_FILE} as the reason says, then install again`,
        `read_app_schema answers what ${MANIFEST_FILE} may hold`,
      ]);
    const install: TagmaAppInstall = { id, source, enabled: input.enabled };
    yield* installs((current) => [...current.filter((entry) => entry.id !== id), install]);
    if (input.enabled) {
      yield* shown(projectId, id, true);
      yield* supervisor.ensure(id, source);
    } else yield* supervisor.stop(id);
    return yield* row(projectId, id);
  });

  return TagmaApps.of({
    call: supervisor.call,
    callAdmitted: supervisor.callAdmitted,
    read: supervisor.read,
    subscribe: supervisor.subscribe,
    start: Effect.fn('TagmaApps.start')(function* () {
      yield* Effect.forEach(
        (yield* settings.value(tagmaAppsInstalled)).filter((install) => install.enabled),
        (install) => supervisor.ensure(install.id, install.source),
        { concurrency: 'unbounded', discard: true },
      );
    }),
    pending: (id) =>
      Effect.map(
        settings.value(tagmaAppsInstalled),
        (standing) => standing.some((install) => install.id === id && install.enabled) && supervisor.reading(id)?.state !== 'running',
      ),
    list: Effect.fn('TagmaApps.list')(function* (projectId) {
      const candidates = Map.groupBy(yield* found(projectId), (entry) => entry.id);
      const installed = new Map((yield* settings.value(tagmaAppsInstalled)).map((install) => [install.id, install]));
      const enabled = new Set(yield* settings.value(tagmaAppsEnabled, projectId));
      const ids = [...new Set([...candidates.keys(), ...installed.keys()])].sort();
      return yield* Effect.forEach(ids, (id) => rowOf(id, candidates.get(id) ?? [], installed.get(id), enabled.has(id)));
    }),
    install: Effect.fn('TagmaApps.install')((input) => locked(input.id, installing(input))),
    uninstall: Effect.fn('TagmaApps.uninstall')(function* (input) {
      const { id, projectId } = input;
      return yield* locked(
        id,
        Effect.gen(function* () {
          yield* installed(id);
          yield* secrets
            .drop(SECRET_KIND, id)
            .pipe(
              Effect.mapError(
                () =>
                  new GateRefusal('secret-store-failed', `${id} stays installed: its secret values could not be dropped.`, [
                    'make secrets.json in the server’s data directory readable and writable to the server, then uninstall again',
                  ]),
              ),
            );
          yield* installs((current) => current.filter((entry) => entry.id !== id));
          for (const project of yield* projects.list()) {
            if ((yield* settings.value(tagmaAppsEnabled, project.id)).includes(id)) yield* shown(project.id, id, false);
          }
          yield* supervisor.stop(id);
          return yield* row(projectId, id);
        }),
      );
    }),
    enable: Effect.fn('TagmaApps.enable')(function* (input) {
      const { id, projectId } = input;
      return yield* locked(
        id,
        Effect.gen(function* () {
          if (input.enabled) yield* installed(id);
          yield* shown(projectId, id, input.enabled);
          return yield* row(projectId, id);
        }),
      );
    }),
  });
});
