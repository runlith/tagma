import { mintCursor, pageRows, type PageQuestion, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../platform/contract/wire/refusal.js';
import { Access } from './contract/service/access.js';
import { type DevicePlace, Devices } from './contract/service/devices.js';
import { DEVICE_ROWS, REMOTE_OPERATIONS as OPS, type RemoteOperationId } from './contract/wire/operations.js';

const CEILING = ceilingOf(DEVICE_ROWS);

const QUESTION: PageQuestion = { operation: 'list_devices', selection: {}, order: DEVICE_ROWS.order };

const placeOf = (key: readonly unknown[]): DevicePlace | null => {
  const [pairedAt, id] = key;
  return key.length === 2 && typeof pairedAt === 'number' && typeof id === 'string' ? { pairedAt, id } : null;
};

export const REMOTE_PAIRS: { readonly [K in RemoteOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_remote_access: pair(
    OPS.read_remote_access,
    body(OPS.read_remote_access, {
      execute: Effect.fnUntraced(function* (_input, _prepared, caller) {
        const reading = yield* (yield* Access).read;
        const pairing = yield* (yield* Devices).standing;
        const device = caller.actor.kind === 'operator' ? (caller.actor.deviceId ?? null) : null;
        return { status: 'read' as const, ...reading, pairing, device };
      }),
    }),
  ),
  create_pairing: pair(
    OPS.create_pairing,
    body(OPS.create_pairing, {
      execute: Effect.fnUntraced(function* () {
        return { status: 'issued' as const, pairing: yield* (yield* Devices).code };
      }),
    }),
  ),
  list_devices: pair(
    OPS.list_devices,
    body(OPS.list_devices, {
      execute: Effect.fnUntraced(function* (input) {
        const read = input.cursor === undefined ? null : readCursor(input.cursor, QUESTION);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const after = read === null ? null : placeOf(read.at);
        if (read !== null && after === null) return yield* cursorRefusal('bad-cursor');
        const page = yield* (yield* Devices).list({ limit: pageRows(input.limit, DEVICE_ROWS, CEILING), after });
        return {
          status: 'listed' as const,
          devices: page.devices,
          shown: page.devices.length,
          total: page.total,
          next: page.more && page.last !== null ? mintCursor(QUESTION, [page.last.pairedAt, page.last.id]) : null,
        };
      }),
    }),
  ),
  revoke_device: pair(
    OPS.revoke_device,
    body(OPS.revoke_device, {
      execute: Effect.fnUntraced(function* (input) {
        yield* (yield* Devices).revoke(input.device);
        return { status: 'revoked' as const, device: input.device };
      }),
    }),
  ),
};
