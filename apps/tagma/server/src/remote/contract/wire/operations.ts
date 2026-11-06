import { family, PAGE_CURSOR } from '@runlith/paging';
import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { AccessState, Device, Pairing } from './access.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';

export const DEVICE_ROWS = family('devices', 1, 'json', { text: 150, json: 150 }, 'ceiling', () => ({
  id: '0b6f7f3c-6a52-4c4e-9a0f-2f1c5b3e8d71',
  name: 'Samsung Internet · Chromebook',
  pairedAt: '2026-10-05T13:35:29.970Z',
  lastSeenAt: '2026-10-05T13:35:29.970Z',
}));

const operatorOnly = {
  doors: { http: 'perform' },
  callers: 'operator',
  subject: 'none',
  place: 'machine',
  waits: [],
  lifetimes: [],
} as const;
const nobody = () => [];

export const REMOTE_OPERATIONS = {
  read_remote_access: operation('read_remote_access', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    meaning:
      "Read whether this server is open to paired devices on another network, the states of the door and the proxy of MCP App views, the server's machine name, the pairing code that stands and which device is asking.",
    grammar:
      'A blocked door names its problem, Tailscale’s own words and the command or link that clears it; reading it again tries once more. `sandbox` reports the proxy of MCP App views: its failure keeps the door ready. `pairing` is null until a code was made and while none stands.',
    input: Schema.Struct({}),
    answer: arms({
      read: {
        enabled: Schema.Boolean,
        state: AccessState,
        sandbox: AccessState,
        machine: Schema.String,
        pairing: Schema.NullOr(Pairing),
        device: Schema.NullOr(Schema.String),
      },
    }),
    refusals: [],
    effect: 'read',
    identity: 'none',
    subjects: nobody,
    confirmation: () => ({ summary: 'Read the remote access?' }),
    confirmLabel: 'Read remote access',
    presentation: { running: 'Reading the remote access', done: 'Read the remote access' },
  }),
  create_pairing: operation('create_pairing', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    meaning: 'Answer the pairing code a new device types or scans to join this server, making one when none stands.',
    grammar: 'One code stands at a time and lives five minutes: asked again, the same code answers until it is used or expires.',
    input: Schema.Struct({}),
    answer: arms({ issued: { pairing: Pairing } }),
    refusals: ['remote-not-ready'],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: () => ({ summary: 'Make a pairing code?' }),
    confirmLabel: 'Make pairing code',
    presentation: { running: 'Making a pairing code', done: 'Made a pairing code' },
  }),
  list_devices: operation('list_devices', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    meaning: 'List the devices paired with this server, newest first, each with when it was paired and last connected.',
    grammar: 'A page of rows with the total; `next` continues the walk and is null on the last page.',
    input: Schema.Struct({ limit: limitOf(DEVICE_ROWS), cursor: PAGE_CURSOR }),
    answer: arms({ listed: { devices: Schema.Array(Device), shown: Schema.Int, total: Schema.Int, next: Schema.NullOr(Schema.String) } }),
    refusals: ['bad-cursor', 'cursor-stale'],
    effect: 'read',
    identity: 'none',
    page: DEVICE_ROWS,
    subjects: nobody,
    confirmation: () => ({ summary: 'List the paired devices?' }),
    confirmLabel: 'List devices',
    presentation: { running: 'Listing the paired devices', done: 'Listed the paired devices' },
  }),
  revoke_device: operation('revoke_device', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    meaning: 'Remove a paired device: its connections close at once and it reaches this server again only through a new pairing.',
    input: Schema.Struct({ device: Schema.String.annotate({ description: 'The device id list_devices answered.' }) }),
    answer: arms({ revoked: { device: Schema.String } }),
    refusals: ['unknown-device'],
    effect: 'write',
    identity: { key: 'request' },
    intent: 'destructive',
    destructiveConsequence: (input) => `Device ${input.device} loses access to this server; it pairs again only with a new code.`,
    subjects: nobody,
    confirmation: (input) => ({ summary: `Remove device ${input.device}?` }),
    confirmLabel: 'Remove device',
    presentation: { running: 'Removing the device', done: 'Removed the device' },
  }),
};

export type RemoteOperationId = keyof typeof REMOTE_OPERATIONS;
