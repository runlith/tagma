import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { Effect, FileSystem, PubSub, Result, Semaphore, Stream } from 'effect';
import type { Settings } from '../settings/contract/service/values.js';
import { type PluginPackage, PluginUnreadable } from './contract/service/format.js';
import {
  type BuiltinPlugin,
  type PluginFaults,
  PluginRevisions,
  type ProviderPart,
  ProviderParts,
  type RevisionHolder,
  type RevisionRecords,
} from './contract/service/plugins.js';
import { PROVIDER_FAULTS } from './contract/wire/rows.js';
import { type PluginInstall, pluginsInstalled, pluginsOff } from './contract/wire/settings.js';
import type { Digests } from './digests.js';
import type { Shelf } from './shelf.js';

const REVISIONS = 'plugin-revisions';

const STAGING = '.staging-';
const RETIRED = '.retired-';
const POINT = PROVIDER_FAULTS.revisions;

type Part = NonNullable<PluginPackage['providers']>;

type Standing = {
  readonly root: string;
  readonly directory: string;
  readonly title: string;
  readonly version: string | null;
  readonly providers: ProviderPart['providers'];
};

const reasonOf = (failure: unknown): string =>
  failure instanceof Error
    ? failure.message
    : typeof failure === 'object' && failure !== null && 'message' in failure
      ? String(failure.message)
      : String(failure);

const sameParts = (left: readonly ProviderPart[], right: readonly ProviderPart[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const revisionOf = (pkg: PluginPackage, part: Part, files: string): string =>
  createHash('sha256')
    .update(files)
    .update('\0')
    .update(
      JSON.stringify({
        id: pkg.name,
        version: pkg.version,
        providers: { entry: part.entry, models: part.models, harnesses: part.harnesses, speech: part.speech },
      }),
    )
    .digest('hex');

export const makeRevisions = Effect.fnUntraced(function* (input: {
  readonly home: string;
  readonly shelf: Shelf;
  readonly digests: Digests;
  readonly builtins: readonly BuiltinPlugin[];
  readonly faults: PluginFaults['Service'];
  readonly settings: Settings['Service'];
  readonly records: RevisionRecords['Service'];
  readonly touched: Stream.Stream<string>;
}) {
  const { home, shelf, digests, builtins, faults, settings, records, touched } = input;
  const files = yield* FileSystem.FileSystem;
  const base = join(home, REVISIONS);
  const lock = yield* Semaphore.make(1);
  const sweeping = yield* Semaphore.make(1);
  const standing = new Map<string, Standing>();
  const leases = new Map<string, number>();
  const handed = new Map<string, number>();
  const placing = new Set<string>();
  const holders = new Set<RevisionHolder>();
  let moment = 0;
  let parts: readonly ProviderPart[] = [];

  const moves = yield* Effect.acquireRelease(PubSub.sliding<readonly ProviderPart[]>({ capacity: 1, replay: 1 }), PubSub.shutdown);

  const inside = (directory: string): boolean => {
    const path = relative(base, directory);
    return path !== '' && !path.startsWith('..') && path.split(sep).length === 2;
  };

  const copied = Effect.fn('PluginRevisions.copy')(function* (install: PluginInstall, part: Part, digest: string, revision: string) {
    const { id, root } = install;
    const directory = join(base, id, revision.slice(0, 16));
    if (yield* files.exists(directory)) return directory;
    const stage = join(base, id, `${STAGING}${randomUUID()}`);
    placing.add(directory);
    return yield* Effect.gen(function* () {
      for (const path of new Set([...part.files, part.manifest])) {
        yield* files.makeDirectory(dirname(join(stage, path)), { recursive: true });
        yield* files.copyFile(join(root, path), join(stage, path));
      }
      const taken = yield* digests.digest(stage, part.files, 'revision');
      digests.forget(stage);
      const after = (yield* shelf.read(root, install.declared ?? null)).package;
      if (taken !== digest || after.providers === null || revisionOf(after, after.providers, digest) !== revision) {
        yield* files.remove(stage, { recursive: true, force: true });
        return null;
      }
      yield* files
        .rename(stage, directory)
        .pipe(
          Effect.catch((failure) =>
            Effect.flatMap(files.exists(directory), (raced) =>
              raced ? files.remove(stage, { recursive: true, force: true }) : Effect.fail(failure),
            ),
          ),
        );
      return directory;
    }).pipe(Effect.ensuring(Effect.sync(() => placing.delete(directory))));
  });

  const synced = Effect.fnUntraced(function* (install: PluginInstall) {
    const { id, root } = install;
    const read = yield* Effect.result(shelf.read(root, install.declared ?? null));
    if (read._tag === 'Failure') {
      if (standing.has(id))
        faults.put(id, POINT, {
          title: 'Its directory does not read now, so the providers it brought before stay.',
          detail: read.failure.message,
        });
      return;
    }
    const pkg = read.success.package;
    const part = pkg.providers;
    if (part === null) {
      standing.delete(id);
      faults.clear(id, POINT);
      return;
    }
    const providers = { models: part.models, harnesses: part.harnesses, speech: part.speech };
    const taken = yield* Effect.result(
      Effect.gen(function* () {
        const digest = yield* digests.digest(root, part.files, 'revision');
        return digest === null ? null : yield* copied(install, part, digest, revisionOf(pkg, part, digest));
      }),
    );
    if (taken._tag === 'Failure') {
      faults.put(id, POINT, {
        title: 'Its providers could not be copied into a revision of their own, so the ones before stay.',
        detail: reasonOf(taken.failure),
      });
      return;
    }
    if (taken.success === null) return;
    faults.clear(id, POINT);
    standing.set(id, { root, directory: taken.success, title: pkg.title ?? pkg.name, version: pkg.version, providers });
  });

  const kept = (after = 0): ReadonlySet<string> =>
    new Set([
      ...leases.keys(),
      ...[...handed].flatMap(([directory, at]) => (at > after ? [directory] : [])),
      ...placing,
      ...[...standing.values()].map((held) => held.directory),
      ...parts.flatMap((part) => (part.directory === null ? [] : [part.directory])),
      ...[...holders].flatMap((holder) => [...holder.standing()]),
    ]);

  const collect = Effect.fn('PluginRevisions.sweep')(function* (boot: boolean) {
    const mark = ++moment;
    const recorded = yield* records.recorded;
    const retired = yield* Effect.try({
      try: () => {
        if (!existsSync(base)) return [];
        const live = new Set([...kept(mark), ...recorded]);
        const away: string[] = [];
        const retire = (path: string) => {
          const target = join(base, `${RETIRED}${++moment}`);
          renameSync(path, target);
          away.push(target);
        };
        for (const id of readdirSync(base)) {
          const at = join(base, id);
          if (id.startsWith(RETIRED)) {
            away.push(at);
            continue;
          }
          if (id.startsWith('.')) {
            if (boot) retire(at);
            continue;
          }
          let left = 0;
          for (const revision of readdirSync(at)) {
            const directory = join(at, revision);
            if (revision.startsWith('.') ? !boot : live.has(directory)) left += 1;
            else retire(directory);
          }
          if (left === 0) retire(at);
        }
        return away;
      },
      catch: (failure) => new PluginUnreadable({ path: base, reason: reasonOf(failure) }),
    });
    for (const [directory, at] of handed) if (at < mark) handed.delete(directory);
    yield* Effect.validate(retired, (away) => files.remove(away, { recursive: true, force: true }), { discard: true }).pipe(
      Effect.mapError((failures) => new PluginUnreadable({ path: base, reason: failures.map(reasonOf).join('; ') })),
    );
  });

  const collected = (boot: boolean) =>
    Effect.flatMap(Effect.result(sweeping.withPermit(collect(boot))), (done) =>
      Result.isFailure(done)
        ? Effect.logWarning('earlier plugin revisions stay until the next collection', { reason: reasonOf(done.failure) })
        : Effect.void,
    );

  const published = Effect.fnUntraced(function* (installs: readonly PluginInstall[]) {
    const off = new Set(yield* settings.value(pluginsOff));
    const next: readonly ProviderPart[] = [
      ...builtins.map((plugin) => ({
        id: plugin.id,
        title: plugin.title,
        version: null,
        builtin: true,
        directory: null,
        providers: plugin.providers,
        off: off.has(plugin.id),
      })),
      ...installs.flatMap((install) => {
        const held = standing.get(install.id);
        return held === undefined
          ? []
          : [
              {
                id: install.id,
                title: held.title,
                version: held.version,
                builtin: false,
                directory: held.directory,
                providers: held.providers,
                off: off.has(install.id),
              },
            ];
      }),
    ];
    if (sameParts(parts, next)) return false;
    parts = next;
    yield* PubSub.publish(moves, next);
    return true;
  });

  const refresh = Effect.fn('PluginRevisions.refresh')(function* (only: ReadonlySet<string> | null) {
    const installs = yield* settings.value(pluginsInstalled);
    const ids = new Set(installs.map((install) => install.id));
    for (const id of standing.keys()) if (!ids.has(id)) standing.delete(id);
    for (const install of installs) if (only === null || only.has(install.id)) yield* synced(install);
    return yield* published(installs);
  });

  const refreshed = (only: ReadonlySet<string> | null) =>
    Effect.flatMap(Effect.result(lock.withPermit(refresh(only))), (done) =>
      Result.isFailure(done)
        ? Effect.logWarning('the plugins’ provider parts stay as they were read last', { reason: reasonOf(done.failure) })
        : done.success
          ? collected(false)
          : Effect.void,
    );

  const released = (directory: string, recorded: boolean) =>
    Effect.suspend(() => {
      const left = (leases.get(directory) ?? 1) - 1;
      if (left > 0) leases.set(directory, left);
      else leases.delete(directory);
      if (recorded) {
        handed.set(directory, ++moment);
        return Effect.void;
      }
      return left > 0 || kept().has(directory) ? Effect.void : collected(false);
    });

  const installed = yield* settings.changes(pluginsInstalled).pipe(Effect.orDie);
  const off = yield* settings.changes(pluginsOff).pipe(Effect.orDie);
  let entries = new Map<string, string>();
  const moved = (installs: readonly PluginInstall[]): ReadonlySet<string> => {
    const next = new Map(installs.map((install) => [install.id, JSON.stringify(install)] as const));
    const changed = new Set([...next].flatMap(([id, entry]) => (entries.get(id) === entry ? [] : [id])));
    entries = next;
    return changed;
  };
  moved(yield* settings.value(pluginsInstalled).pipe(Effect.orDie));
  yield* refreshed(null);
  yield* collected(true);
  yield* Effect.forkScoped(Stream.runForEach(Stream.drop(installed, 1), (installs) => refreshed(moved(installs))));
  yield* Effect.forkScoped(Stream.runForEach(Stream.drop(off, 1), () => refreshed(new Set())));
  yield* Effect.forkScoped(Stream.runForEach(touched, (id) => refreshed(new Set([id]))));

  return {
    parts: ProviderParts.of({ current: () => parts, changes: Stream.fromPubSub(moves) }),
    revisions: PluginRevisions.of({
      hold: (directory, recorded = false) => {
        if (directory === null || !inside(directory)) return Effect.succeed(true);
        return Effect.acquireRelease(
          Effect.sync(() => {
            if (!existsSync(directory)) return false;
            leases.set(directory, (leases.get(directory) ?? 0) + 1);
            return true;
          }),
          (held) => (held ? released(directory, recorded) : Effect.void),
        );
      },
      register: (holder) =>
        Effect.asVoid(
          Effect.acquireRelease(
            Effect.sync(() => holders.add(holder)),
            () => Effect.sync(() => void holders.delete(holder)),
          ),
        ),
      released: collected(false),
    }),
  };
});
