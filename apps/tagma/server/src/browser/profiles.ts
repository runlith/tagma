import { Clock, Effect, Layer, PubSub, Schema, Semaphore, Stream } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Settings } from '../settings/contract/service/values.js';
import { type Host, HostAdapters, Hosts } from './contract/service/hosts.js';
import { Pages } from './contract/service/pages.js';
import { Profiles } from './contract/service/profiles.js';
import { ProfileId } from './contract/wire/ids.js';
import type { Profile } from './contract/wire/profile.js';
import { agentProfile, userProfile } from './contract/wire/settings.js';
import { Ledger, type ProfileRow } from './store/ledger.js';

export const makeProfiles = Effect.gen(function* () {
  const ledger = yield* Ledger;
  const hosts = yield* Hosts;
  const pages = yield* Pages;
  const settings = yield* Settings;
  const { all: adapters } = yield* HostAdapters;
  const now = new Date(yield* Clock.currentTimeMillis);
  const changed = yield* PubSub.unbounded<ProfileId>();
  const locks = new Map<ProfileId, Semaphore.Semaphore>();

  yield* Effect.orDie(
    ledger.seed(
      adapters.flatMap((adapter) =>
        adapter.seeds.map((seed): ProfileRow => ({
          id: seed.id,
          name: seed.name,
          adapter: adapter.id,
          document: seed.document,
          console: 'auto',
          removal: null,
          createdAt: now,
        })),
      ),
    ),
  );

  const wire = (row: ProfileRow): Profile => ({
    id: row.id,
    name: row.name,
    adapter: row.adapter,
    console: row.console,
    connected: hosts.connected(row.adapter) !== undefined,
    removal: row.removal,
    createdAt: row.createdAt.toISOString(),
  });

  const unknown = (id: ProfileId) =>
    new GateRefusal('profile-unknown', `no browser profile ${id} stands on this machine`, ['list_profiles — the profiles of this machine']);

  const standing = Effect.fnUntraced(function* (id: ProfileId) {
    const row = yield* ledger.profile(id);
    if (row === undefined || row.removal === 'delete') return yield* unknown(id);
    return row;
  });

  const sweep = Effect.fnUntraced(function* (host: Host) {
    const marked = (yield* Effect.orDie(ledger.profiles)).filter((row) => row.adapter === host.adapter && row.removal !== null);
    for (const row of marked) {
      const removed = yield* Effect.exit(host.profiles.remove(row.id));
      if (removed._tag === 'Failure') {
        yield* Effect.logWarning(`browser: host ${host.id} did not remove the storage of profile ${row.id}`, removed.cause);
        continue;
      }
      yield* Effect.orDie(row.removal === 'delete' ? ledger.dropProfile(row.id) : ledger.markProfile(row.id, null));
    }
  });

  yield* hosts.watch({ attached: sweep, detached: () => Effect.void });

  const removeOn = Effect.fnUntraced(function* (row: ProfileRow, removal: 'delete' | 'clear') {
    yield* pages.closeProfile(row.id);
    const host = hosts.connected(row.adapter);
    if (host === undefined) {
      yield* ledger.markProfile(row.id, removal);
      return true;
    }
    const removed = yield* Effect.exit(host.profiles.remove(row.id));
    if (removed._tag === 'Failure') {
      yield* Effect.logWarning(
        `browser: host ${host.id} did not remove the storage of profile ${row.id}; it is marked for its next connection`,
        removed.cause,
      );
      yield* ledger.markProfile(row.id, removal);
      return true;
    }
    if (removal === 'delete') yield* ledger.dropProfile(row.id);
    return false;
  });

  return Profiles.of({
    list: Effect.map(ledger.profiles, (rows) => rows.map(wire)),
    record: standing,
    chosen: (projectId, human) => settings.value(human ? userProfile : agentProfile, projectId),
    create: Effect.fn('Profiles.create')(function* (draft) {
      const adapter = adapters.find((held) => held.id === draft.adapter);
      if (adapter === undefined) {
        return yield* new GateRefusal('adapter-unknown', `no browser host adapter ${draft.adapter} is part of this server`, [
          `name one of: ${adapters.map((held) => held.id).join(', ')}`,
        ]);
      }
      const document = yield* Schema.decodeUnknownEffect(adapter.document)(draft.document ?? adapter.fallback).pipe(
        Effect.mapError(
          (failure) =>
            new GateRefusal('document-invalid', `the ${adapter.id} adapter does not take this document: ${failure.message}`, [
              'send the document the adapter describes',
            ]),
        ),
      );
      const row: ProfileRow = {
        id: ProfileId.make(Bun.randomUUIDv7()),
        name: draft.name,
        adapter: adapter.id,
        document,
        console: draft.console ?? 'auto',
        removal: null,
        createdAt: new Date(yield* Clock.currentTimeMillis),
      };
      yield* ledger.putProfile(row);
      return wire(row);
    }),
    update: Effect.fn('Profiles.update')(function* (id, change) {
      yield* standing(id);
      const unchanged = change.name === undefined && change.console === undefined;
      const row = unchanged ? yield* ledger.profile(id) : yield* ledger.changeProfile(id, { name: change.name, console: change.console });
      if (row === undefined) return yield* unknown(id);
      if (change.console !== undefined) yield* PubSub.publish(changed, id);
      return wire(row);
    }),
    remove: Effect.fn('Profiles.remove')(function* (id) {
      return yield* removeOn(yield* standing(id), 'delete');
    }),
    clear: Effect.fn('Profiles.clear')(function* (id) {
      return yield* removeOn(yield* standing(id), 'clear');
    }),
    connected: Effect.map(ledger.profiles, (rows) =>
      rows.filter((row) => row.removal === null && hosts.connected(row.adapter) !== undefined).map((row) => row.id),
    ),
    changes: Effect.map(PubSub.subscribe(changed), (subscription) => Stream.fromSubscription(subscription)),
    exclusive: (id, work) => {
      let lock = locks.get(id);
      if (lock === undefined) {
        lock = Semaphore.makeUnsafe(1);
        locks.set(id, lock);
      }
      return lock.withPermits(1)(work);
    },
  });
});

export const profilesLayer = Layer.effect(Profiles, makeProfiles);
