import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { QuotaUnavailable } from '@runlith/llm/schema/quota';
import { Effect } from 'effect';
import { accounts } from './accounts';
import { catalog } from './catalog';
import { accountEnvironment } from './environment';
import { installedProgram } from './host';
import { icon } from './icon';

export const adapter = defineAdapter(() => [
  {
    id: 'opencode',
    label: 'OpenCode',
    kind: 'harness',
    auth: 'cli',
    icon,
    accounts: accounts(installedProgram()),
    catalog,
    quota: {
      fromHeaders: () => null,
      read: () => Effect.fail(new QuotaUnavailable({ reason: 'OpenCode does not expose upstream account quota.' })),
    },
    environment: accountEnvironment,
    dynamicCatalog: true,
    models: {},
    defaultTextModel: '',
    cacheLifetime: { promisedSeconds: null, prior: null },
    accountMode: {
      section: 'opencode',
      title: 'OpenCode',
      default: 'opencode',
      id: 'opencode',
      label: 'OpenCode',
      hint: 'Uses the upstream logins kept by OpenCode in this profile. OpenCode keeps and renews its credentials.',
    },
  },
]);
