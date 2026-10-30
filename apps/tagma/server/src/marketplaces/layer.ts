import { resolve } from 'node:path';
import { Clock, Effect, FileSystem, Layer, PubSub, Semaphore, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { within } from '../plugins/contract/service/reading.js';
import { EnabledPlugins, Plugins } from '../plugins/contract/service/plugins.js';
import type { PluginSource } from '../plugins/contract/wire/rows.js';
import { Settings } from '../settings/contract/service/values.js';
import { ListFormats, type MarketplaceList } from './contract/service/lists.js';
import { MarketplacePlaces, MarketplacePresets, Marketplaces, type Picked } from './contract/service/marketplaces.js';
import { type EntryRow, MARKETPLACE_ID_PATTERN, type MarketplaceRow, type MarketplaceSource, TRUST_LABELS } from './contract/wire/rows.js';
import { type MarketplaceAdded, marketplacesAdded, marketplacesPresets } from './contract/wire/settings.js';
import { entryRowOf, entryRows, escapes, installedOf } from './entries.js';
import {
  clearStaging,
  type Detail,
  detailed,
  dropFetched,
  dropRevision,
  type Fetched,
  fetchRevision,
  type ListUnreachable,
  type ListUnreadable,
  removed,
  type Revision,
  storedRevision,
  storedRevisionOf,
} from './revisions.js';

type Stored = { readonly revision: Revision | null; readonly failure: { readonly reason: string; readonly at: number } | null };

const WRITERS = 1_000;

const DESCRIBING = 8;

const READ = 'read_marketplaces names every marketplace added and its entries';

const sameSource = (a: MarketplaceSource, b: MarketplaceSource): boolean =>
  a.kind === 'git' ? b.kind === 'git' && a.url === b.url : b.kind === 'folder' && a.path === b.path;

const byTrust = (a: MarketplaceAdded, b: MarketplaceAdded): number => TRUST_LABELS.indexOf(a.label) - TRUST_LABELS.indexOf(b.label);

const byKey = (a: EntryRow, b: EntryRow): number =>
  a.marketplace !== b.marketplace ? (a.marketplace < b.marketplace ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

const refusedOf = (failure: ListUnreachable | ListUnreadable, source: MarketplaceSource) => {
  const from = source.kind === 'git' ? source.url : source.path;
  return failure._tag === 'ListUnreachable'
    ? new GateRefusal('marketplace-unreachable', `${from} could not be fetched: ${failure.reason}`, [
        'check that the address is right and that git can reach it as the operator, then try again',
      ])
    : new GateRefusal('marketplace-unreadable', `${from} holds no marketplace list Tagma reads: ${failure.reason}`, [
        'name a repository or folder with .claude-plugin/marketplace.json or .agents/plugins/marketplace.json',
      ]);
};

const unknown = (id: string) =>
  new GateRefusal('marketplace-unknown', `No marketplace ${id} is added on this machine.`, [
    READ,
    'add_marketplace adds one by its address',
  ]);

const unstored = (id: string) => (failure: { readonly message: string }) =>
  new GateRefusal('marketplace-unreachable', `The list of ${id} could not be stored: ${failure.message}`, [
    'make the server’s data directory writable to it, then try again',
  ]);

const entryRefused = (marketplace: string, name: string, reason: string) =>
  new GateRefusal('marketplace-entry-refused', `${name} in ${marketplace}: ${reason}.`, [READ]);

export const makeMarketplaces = Effect.gen(function* () {
  const { home } = yield* MarketplacePlaces;
  const presets = yield* MarketplacePresets;
  const formats = yield* ListFormats;
  const settings = yield* Settings;
  const plugins = yield* Plugins;
  const enabled = yield* EnabledPlugins;
  const files = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scope = yield* Effect.scope;
  const gate = yield* Semaphore.make(WRITERS);
  const pulses = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1, replay: 1 }), PubSub.shutdown);
  const stored = new Map<string, Stored>();

  const changed = Effect.asVoid(PubSub.publish(pulses, undefined));
  const added = settings.value(marketplacesAdded);
  const locked = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> => gate.withPermits(WRITERS)(work);
  const reading = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => gate.withPermits(1)(work);
  const provided = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, files),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

  yield* changed;
  yield* Effect.forkIn(
    Stream.runForEach(enabled.changes, () => changed),
    scope,
  );

  const loaded = Effect.fnUntraced(function* (registration: MarketplaceAdded) {
    const revision = yield* storedRevisionOf({ home, id: registration.id, source: registration.source, formats });
    return { revision, failure: null } satisfies Stored;
  });

  const unloaded = (failure: ListUnreachable | ListUnreadable) =>
    Effect.map(Clock.currentTimeMillis, (at): Stored => ({ revision: null, failure: { reason: failure.reason, at } }));

  for (const registration of yield* Effect.orDie(added)) {
    stored.set(
      registration.id,
      yield* provided(loaded(registration)).pipe(Effect.catchTags({ ListUnreachable: unloaded, ListUnreadable: unloaded })),
    );
  }

  const rowOf = (registration: MarketplaceAdded): MarketplaceRow => {
    const { revision, failure } = stored.get(registration.id) ?? { revision: null, failure: null };
    return {
      id: registration.id,
      title: registration.title ?? revision?.list.title ?? revision?.list.name ?? registration.id,
      description: revision?.list.description ?? null,
      owner: revision?.list.owner ?? null,
      label: registration.label,
      source: registration.source,
      format: revision?.format ?? null,
      revision: revision === null ? null : { commit: revision.commit, fetched: new Date(revision.fetched).toISOString() },
      failure: failure === null ? null : { reason: failure.reason, at: new Date(failure.at).toISOString() },
      entries: revision === null ? 0 : revision.list.entries.length + revision.list.faults.length,
    };
  };

  const registered = Effect.fnUntraced(function* (id: string) {
    const registration = (yield* added).find((entry) => entry.id === id);
    return registration ?? (yield* unknown(id));
  });

  const kept = Effect.fnUntraced(function* (id: string, got: Fetched) {
    const { revision, leftovers } = yield* provided(storedRevision(home, id, got)).pipe(Effect.mapError(unstored(id)));
    stored.set(id, { revision, failure: null });
    yield* provided(removed(leftovers)).pipe(Effect.mapError(unstored(id)));
  });

  const described = Effect.fnUntraced(function* (root: string, list: MarketplaceList) {
    const details: Record<string, Detail> = {};
    const bare = list.entries.flatMap((entry) =>
      entry.source.kind === 'path' &&
      !escapes(root, entry.source.path) &&
      (entry.title === null || entry.description === null || entry.brings.length === 0)
        ? [{ name: entry.name, path: entry.source.path, manifest: entry.manifest ?? undefined }]
        : [],
    );
    yield* Effect.forEach(
      bare,
      ({ name, path, manifest }) =>
        Effect.map(plugins.describe({ root: resolve(root, path), declared: { name, manifest } }), (detail) => {
          if (detail !== null) details[name] = detail;
        }),
      { concurrency: DESCRIBING, discard: true },
    );
    return details;
  });

  const fetched = Effect.fnUntraced(function* (source: MarketplaceSource) {
    const got = yield* provided(fetchRevision({ home, source, formats, now: yield* Clock.currentTimeMillis }));
    const details = yield* described(got.root, got.list);
    return { ...got, details, list: detailed(got.list, details) } satisfies Fetched;
  });

  const failed = Effect.fnUntraced(function* (registration: MarketplaceAdded, failure: ListUnreachable | ListUnreadable) {
    stored.set(registration.id, {
      revision: stored.get(registration.id)?.revision ?? null,
      failure: { reason: failure.reason, at: yield* Clock.currentTimeMillis },
    });
    yield* changed;
    return yield* refusedOf(failure, registration.source);
  });

  const refreshed = Effect.fnUntraced(function* (registration: MarketplaceAdded, got: Fetched) {
    yield* kept(registration.id, got);
    yield* changed;
    return rowOf(registration);
  });

  const refresh = Effect.fn('Marketplaces.refresh')(function* (id: string) {
    return yield* locked(
      Effect.gen(function* () {
        const registration = yield* registered(id);
        return yield* fetched(registration.source).pipe(
          Effect.matchEffect({
            onFailure: (failure) => failed(registration, failure),
            onSuccess: (got) => refreshed(registration, got),
          }),
        );
      }),
    );
  });

  const seeded = yield* Effect.orDie(settings.value(marketplacesPresets));
  const fresh = presets.filter((preset) => !seeded.includes(preset.id));
  if (fresh.length > 0) {
    const standing = new Set((yield* Effect.orDie(added)).map((registration) => registration.id));
    const registering = fresh.filter((preset) => !standing.has(preset.id));
    yield* Effect.orDie(
      settings.amend<readonly MarketplaceAdded[], never>(marketplacesAdded, 'user', undefined, (current) =>
        Effect.succeed([...current, ...registering.map(({ id, source, label, title }) => ({ id, source, label, title }))]),
      ),
    );
    yield* Effect.orDie(
      settings.amend<readonly string[], never>(marketplacesPresets, 'user', undefined, (current) =>
        Effect.succeed([...current, ...fresh.map((preset) => preset.id)]),
      ),
    );
    for (const preset of registering) {
      stored.set(preset.id, { revision: null, failure: null });
      yield* Effect.forkIn(
        refresh(preset.id).pipe(
          Effect.tapError((failure) => Effect.logWarning(`the preset marketplace ${preset.id} was not fetched: ${failure.message}`)),
        ),
        scope,
      );
    }
  }

  const pick = Effect.fnUntraced(function* (marketplace: string, name: string) {
    yield* registered(marketplace);
    const revision = stored.get(marketplace)?.revision ?? null;
    if (revision === null) {
      return yield* new GateRefusal('marketplace-unfetched', `${marketplace} has no stored list yet.`, [
        `refresh_marketplace ${marketplace}, then try again`,
      ]);
    }
    const entry = revision.list.entries.find((candidate) => candidate.name === name);
    if (entry === undefined) {
      const fault = revision.list.faults.find((candidate) => candidate.name === name);
      if (fault !== undefined) return yield* entryRefused(marketplace, name, fault.reason);
      return yield* new GateRefusal('marketplace-entry-unknown', `The stored list of ${marketplace} has no entry ${name}.`, [
        READ,
        `refresh_marketplace ${marketplace} if the entry is new`,
      ]);
    }
    const row = entryRowOf(marketplace, revision.root, entry, installedOf(yield* plugins.installs()));
    const origin = { marketplace, entry: name };
    const declared = { name, manifest: entry.manifest ?? undefined };
    const source = entry.source;
    if (row.state === 'refused' || source.kind === 'refused') {
      return yield* entryRefused(marketplace, name, row.reason ?? 'Tagma does not install it');
    }
    if (source.kind === 'git') {
      const resolved: PluginSource = { kind: 'git', url: source.url, path: source.path, ref: source.ref, commit: source.commit };
      return { entry: row, resolved: { source: resolved, origin, declared } } satisfies Picked;
    }
    const asked = resolve(revision.root, source.path);
    const real = yield* Effect.all([files.realPath(revision.root), files.realPath(asked)]).pipe(
      Effect.mapError(() => entryRefused(marketplace, name, `its path ${source.path} does not exist`)),
    );
    if (escapes(revision.root, source.path) || !within(real[0], real[1])) {
      return yield* entryRefused(marketplace, name, `its path ${source.path} leaves the marketplace`);
    }
    return { entry: row, resolved: { source: { kind: 'folder', path: real[1] }, origin, declared } } satisfies Picked;
  });

  return Marketplaces.of({
    rows: () => Effect.map(added, (registrations) => registrations.toSorted(byTrust).map(rowOf)),
    entries: Effect.fn('Marketplaces.entries')(function* (marketplace) {
      const installed = installedOf(yield* plugins.installs());
      return (yield* added)
        .filter((registration) => marketplace === null || registration.id === marketplace)
        .flatMap((registration) => {
          const revision = stored.get(registration.id)?.revision ?? null;
          return revision === null ? [] : entryRows(registration.id, revision, installed);
        })
        .sort(byKey);
    }),
    add: Effect.fn('Marketplaces.add')(function* (source) {
      return yield* locked(
        Effect.gen(function* () {
          const preset = presets.find((candidate) => sameSource(candidate.source, source));
          const got = yield* fetched(source).pipe(Effect.mapError((failure) => refusedOf(failure, source)));
          const id = preset?.id ?? got.list.name.toLowerCase();
          const refused = (refusal: GateRefusal<'marketplace-unreadable' | 'marketplace-taken'>) =>
            Effect.andThen(provided(dropFetched(got)).pipe(Effect.mapError(unstored(id))), Effect.fail(refusal));
          if (!MARKETPLACE_ID_PATTERN.test(id) || id.length > 128) {
            return yield* refused(
              new GateRefusal('marketplace-unreadable', `Its list names itself ${got.list.name}, which cannot name a marketplace.`, [
                'a marketplace name is letters, digits, ., _ and -, starting and ending with a letter or digit',
              ]),
            );
          }
          if ((yield* added).some((registration) => registration.id === id)) {
            return yield* refused(
              new GateRefusal('marketplace-taken', `A marketplace named ${id} is already added.`, [
                `remove_marketplace ${id}, then add this one`,
                READ,
              ]),
            );
          }
          yield* kept(id, got);
          const registration: MarketplaceAdded = { id, source, label: preset?.label ?? 'unreviewed', title: preset?.title };
          yield* settings.amend<readonly MarketplaceAdded[], never>(marketplacesAdded, 'user', undefined, (current) =>
            Effect.succeed([...current, registration]),
          );
          yield* changed;
          return rowOf(registration);
        }),
      );
    }),
    remove: Effect.fn('Marketplaces.remove')(function* (id) {
      return yield* locked(
        Effect.gen(function* () {
          const registration = yield* registered(id);
          const row = rowOf(registration);
          yield* settings.amend<readonly MarketplaceAdded[], never>(marketplacesAdded, 'user', undefined, (current) =>
            Effect.succeed(current.filter((entry) => entry.id !== id)),
          );
          stored.delete(id);
          yield* provided(dropRevision(home, id)).pipe(Effect.mapError(unstored(id)));
          yield* changed;
          return row;
        }),
      );
    }),
    refresh,
    look: Effect.fn('Marketplaces.look')(function* (source) {
      const got = yield* provided(fetchRevision({ home, source, formats, now: yield* Clock.currentTimeMillis })).pipe(
        Effect.catchTag('ListUnreadable', () => Effect.succeed(null)),
        Effect.mapError((failure) => refusedOf(failure, source)),
      );
      if (got === null) return null;
      yield* provided(dropFetched(got)).pipe(Effect.mapError(unstored(source.kind === 'git' ? source.url : source.path)));
      return got.list;
    }),
    entry: (marketplace, name, use) =>
      reading(Effect.flatMap(pick(marketplace, name), use)).pipe(Effect.withSpan('Marketplaces.entry', { attributes: { marketplace } })),
    changes: Stream.fromPubSub(pulses),
  });
});

export const marketplacesLayer = Layer.effect(
  Marketplaces,
  Effect.gen(function* () {
    yield* Effect.orDie(clearStaging((yield* MarketplacePlaces).home));
    return yield* makeMarketplaces;
  }),
);
