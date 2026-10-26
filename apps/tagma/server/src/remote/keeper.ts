import { Clock, Effect, PubSub, Semaphore, Stream } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { type DeviceRevoked, Devices, type PairRequest } from './contract/service/devices.js';
import { DEVICE_TERM_DAYS, PAIRING_MINUTES, type Device, type Pairing } from './contract/wire/access.js';
import { codeDigest, mintCode, Misses } from './code.js';
import { digestOf, mintCredential, provedBy, readCredential } from './credential.js';
import { deviceName } from './naming.js';
import type { Reach } from './reach.js';
import { type DeviceRow, Ledger } from './store/ledger.js';

const DAY_MS = 86_400_000;
const TERM_MS = DEVICE_TERM_DAYS * DAY_MS;
const SEEN_MS = 3_600_000;
const PAIRING_MS = PAIRING_MINUTES * 60_000;
const MISSES_BUDGET = 10;

type Issued = { readonly code: string; readonly digest: string; readonly expiresAt: number; readonly origin: string };

const unpaired = () =>
  new GateRefusal('device-unpaired', 'this device is not paired with this server', [
    'pair it: open the pairing code shown in the Phone & devices settings of this server',
  ]);

const originRefused = () =>
  new GateRefusal('origin-refused', 'this request did not come from the page this server serves to paired devices', [
    'make the request from the Tagma page this server serves',
  ]);

const deviceOf = (row: DeviceRow): Device => ({
  id: row.id,
  name: row.name,
  pairedAt: row.pairedAt.toISOString(),
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
});

const shown = (issued: Issued): Pairing => ({
  code: issued.code,
  expiresAt: new Date(issued.expiresAt).toISOString(),
  url: `${issued.origin}/pair#${issued.code}`,
});

export const makeKeeper = Effect.fnUntraced(function* ({ reach }: { readonly reach: Reach }) {
  const ledger = yield* Ledger;
  const revocations = yield* PubSub.unbounded<DeviceRevoked>();
  const pairing = yield* Semaphore.make(1);
  const misses = new Misses(MISSES_BUDGET, PAIRING_MS);
  let issued: Issued | null = null;

  const exchange = Effect.fn('Devices.exchange')(function* (request: PairRequest, code: string) {
    const now = yield* Clock.currentTimeMillis;
    if (misses.spent(now)) {
      return yield* new GateRefusal('pairing-throttled', 'too many wrong pairing codes were tried on this server', [
        'wait a few minutes, then type the code again',
      ]);
    }
    const digest = codeDigest(code);
    const minted = mintCredential();
    const row: DeviceRow = {
      id: minted.id,
      name: deviceName(request.userAgent),
      secretDigest: digestOf(minted.secret),
      pairedAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(now + TERM_MS),
      revokedAt: null,
    };
    if (!(yield* ledger.exchange(digest, new Date(now), row))) {
      misses.missed(now);
      return yield* new GateRefusal('pairing-refused', 'this pairing code is not the one this server shows, or it has expired', [
        'type the code the Phone & devices settings of this server shows now',
      ]);
    }
    if (issued?.digest === digest) issued = null;
    return { device: deviceOf(row), credential: minted.value, machine: reach.name };
  }, pairing.withPermit);

  return Devices.of({
    admit: Effect.fn('Devices.admit')(function* (request) {
      if (request.mutates && (request.origin === undefined || request.origin !== reach.origin)) return yield* originRefused();
      if (request.fetchSite === 'same-site' || request.fetchSite === 'cross-site') return yield* originRefused();
      const offered = readCredential(request.credential);
      if (offered === null) return yield* unpaired();
      const row = yield* ledger.byId(offered.id);
      const now = yield* Clock.currentTimeMillis;
      if (row === undefined || !provedBy(row.secretDigest, offered.secret)) return yield* unpaired();
      if (row.revokedAt !== null) {
        return yield* new GateRefusal('device-revoked', 'this device was removed from this server', [
          'pair it again with a new code from the Phone & devices settings of this server',
        ]);
      }
      if (row.expiresAt.getTime() <= now) return yield* unpaired();
      const renewed = request.connection && (row.lastSeenAt === null || now - row.lastSeenAt.getTime() >= SEEN_MS);
      if (renewed) yield* ledger.seen(row.id, new Date(now), new Date(now + TERM_MS));
      return { device: row.id, renewed };
    }),
    pair: Effect.fn('Devices.pair')(function* (request, typed) {
      const origin = reach.origin;
      if (origin === null) {
        return yield* new GateRefusal('remote-off', 'access from another network is not open on this server', [
          'turn on access from your phone in the Phone & devices settings of this server',
        ]);
      }
      if (request.origin !== origin) return yield* originRefused();
      return yield* exchange(request, yield* typed);
    }),
    code: Effect.gen(function* () {
      const origin = reach.ready ? reach.origin : null;
      if (origin === null) {
        return yield* new GateRefusal('remote-not-ready', 'access from another network is not ready on this server yet', [
          'read_remote_access says what it waits for',
        ]);
      }
      const now = yield* Clock.currentTimeMillis;
      if (issued !== null && issued.expiresAt > now && issued.origin === origin) return shown(issued);
      const code = mintCode();
      const fresh: Issued = { code, digest: codeDigest(code), expiresAt: now + PAIRING_MS, origin };
      yield* ledger.issue(fresh.digest, new Date(fresh.expiresAt));
      issued = fresh;
      return shown(fresh);
    }).pipe(pairing.withPermit, Effect.withSpan('Devices.code')),
    standing: Effect.map(Clock.currentTimeMillis, (now) =>
      issued === null || issued.expiresAt <= now || issued.origin !== reach.origin ? null : shown(issued),
    ),
    list: Effect.fnUntraced(function* (ask) {
      const { rows, total } = yield* ledger.list(new Date(yield* Clock.currentTimeMillis), ask.after, ask.limit + 1);
      const devices = rows.slice(0, ask.limit);
      const last = devices.at(-1);
      return {
        devices: devices.map(deviceOf),
        total,
        last: last === undefined ? null : { pairedAt: last.pairedAt.getTime(), id: last.id },
        more: rows.length > ask.limit,
      };
    }),
    revoke: Effect.fn('Devices.revoke')(function* (id) {
      if (!(yield* ledger.revoke(id, new Date(yield* Clock.currentTimeMillis)))) {
        return yield* new GateRefusal('unknown-device', `no paired device ${id} stands on this server`, [
          'list_devices names the paired devices',
        ]);
      }
      yield* PubSub.publish(revocations, { deviceId: id });
    }),
    paired: (id) =>
      Effect.flatMap(ledger.byId(id), (row) =>
        Effect.map(Clock.currentTimeMillis, (now) => row !== undefined && row.revokedAt === null && row.expiresAt.getTime() > now),
      ),
    revoked: Stream.fromPubSub(revocations),
  });
});
