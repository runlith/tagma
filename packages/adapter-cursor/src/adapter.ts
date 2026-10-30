import { defineAdapter, type HarnessProvider } from '@runlith/tagma/adapter/provider';
import { accounts } from './accounts';
import { catalog } from './catalog';
import { quota } from './quota';
import { icon } from './icon';
import { cursorProgram } from './program';

import { cursorTerminal } from './harness/cursor';
import { cursorAcp } from './harness/acp';

export const cursor: HarnessProvider = {
  id: 'cursor',
  label: 'Cursor',
  kind: 'harness',
  auth: 'api-key',
  icon,
  harnessLabel: 'Cursor',
  mark: icon,
  terminal: cursorTerminal,
  acp: cursorAcp,
  accounts,
  catalog,
  quota,
  asks: { program: cursorProgram },
  dynamicCatalog: true,
  models: {},
  defaultTextModel: '',
  cacheLifetime: { promisedSeconds: null, prior: null },
  keyHint: 'Browser sign-in creates a 90-day key named Tagma in Cursor API Keys. Removing it here does not revoke the key at Cursor.',
  environment: (credential) => [
    { _tag: 'Set', name: 'CURSOR_API_KEY', value: credential.accessToken },
    { _tag: 'Unset', name: 'CURSOR_AUTH_TOKEN' },
  ],
};

export const adapter = defineAdapter(() => [cursor]);
