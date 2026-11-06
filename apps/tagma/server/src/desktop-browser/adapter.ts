import type { HostAdapter } from '../browser/contract/service/hosts.js';
import { AGENT_PROFILE, USER_PROFILE } from '../browser/contract/wire/ids.js';
import { DESKTOP, DesktopDocument } from './contract/wire/channel.js';

export const desktopAdapter: HostAdapter = {
  id: DESKTOP,
  title: 'Tagma desktop',
  document: DesktopDocument,
  fallback: {},
  seeds: [
    { id: USER_PROFILE, name: 'You', document: {}, input: 'human' },
    { id: AGENT_PROFILE, name: 'Agents', document: {}, input: 'fast' },
  ],
  away: 'open the Tagma app on this machine: desktop pages live in it',
};
