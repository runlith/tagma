import { Effect } from 'effect';
import { QuotaUnavailable } from '@runlith/llm/schema/quota';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { icon } from '../icon.js';
import { accounts } from './accounts.js';
import { MUSE_CODE, MUSE_CODE_CACHE_SECONDS, museCodeAcp } from './acp.js';
import { catalog } from './catalog.js';
import { museCodeProgram } from './program.js';

export const museCode: HarnessProvider = {
  id: MUSE_CODE,
  label: 'Muse Code',
  kind: 'harness',
  auth: 'cli',
  icon,
  harnessLabel: 'Muse Code',
  mark: icon,
  accounts,
  catalog,
  quota: {
    fromHeaders: () => null,
    read: () => Effect.fail(new QuotaUnavailable({ reason: 'Muse Code reports its quota windows once a thread on it has run a turn.' })),
  },
  environment: () => [{ _tag: 'Unset', name: 'META_API_KEY' }],
  asks: { program: museCodeProgram },
  dynamicCatalog: true,
  models: {},
  defaultTextModel: '',
  cacheLifetime: { promisedSeconds: MUSE_CODE_CACHE_SECONDS, prior: null },
  accountMode: {
    section: MUSE_CODE,
    title: 'Muse Code',
    default: MUSE_CODE,
    id: MUSE_CODE,
    label: 'Muse Code',
    hint: 'Uses the login of the Muse Code CLI on this machine (`muse login`). Muse Code keeps and renews it; Tagma holds no Muse credential.',
    missing: "Muse Code isn't installed",
    defaultPlace: '~/.config/muse',
  },
  acp: museCodeAcp,
};
