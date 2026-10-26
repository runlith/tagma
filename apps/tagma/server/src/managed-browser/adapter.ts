import type { HostAdapter } from '../browser/contract/service/hosts.js';
import { ProfileId } from '../browser/contract/wire/ids.js';
import { MANAGED, ManagedDocument } from './contract/wire/document.js';

export const MANAGED_AGENT = ProfileId.make('managed-agent');

export const managedAdapter: HostAdapter = {
  id: MANAGED,
  title: 'Managed Chromium',
  document: ManagedDocument,
  fallback: { build: 'chrome-for-testing' },
  seeds: [{ id: MANAGED_AGENT, name: 'Agent (managed Chromium)', document: { build: 'chrome-for-testing' } }],
  away: 'the managed Chromium runs inside this server; make the call again',
};
