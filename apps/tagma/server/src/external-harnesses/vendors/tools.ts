import type { HarnessTools } from '../contract/service/adapter.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../platform/contract/wire/conditions.js';

export const LEGACY_TOOLS: HarnessTools = {
  names: 'kind',
  byName: {
    bash: { kind: 'execute', approval: ASKS_IN_REVIEW },
    read: { kind: 'read', approval: ASKS_NEVER },
    ls: { kind: 'read', approval: ASKS_NEVER },
    glob: { kind: 'read', approval: ASKS_NEVER },
    grep: { kind: 'read', approval: ASKS_NEVER },
    write: { kind: 'write', approval: ASKS_IN_REVIEW },
    edit: { kind: 'write', approval: ASKS_IN_REVIEW },
    delete: { kind: 'write', approval: ASKS_IN_REVIEW },
    rename: { kind: 'write', approval: ASKS_IN_REVIEW },
    webfetch: { kind: 'network', approval: ASKS_IN_REVIEW },
    websearch: { kind: 'network', approval: ASKS_IN_REVIEW },
  },
};
