import { Schema } from 'effect';
import { settingKey } from '../platform/contract/wire/setting.js';

export const remoteEnabled = settingKey({
  id: 'remote.enabled',
  order: 850,
  title: 'Allow access from your phone',
  description:
    'Whether this server opens its door for paired devices on another network, reached through Tailscale Serve. Off, that door is closed and pairing codes are refused; paired devices stay paired.',
  schema: Schema.Boolean,
  fallback: false,
  scopes: ['user'],
  merge: 'replace',
  operatorOnly: true,
});

export const REMOTE_SETTING_SECTIONS = [
  {
    id: 'remote',
    order: 125,
    title: 'Phone & devices',
    description: 'Devices that reach this server from another network, and the door they come in through.',
  },
] as const;
