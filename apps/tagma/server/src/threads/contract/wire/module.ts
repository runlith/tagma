import { mergeOperations, type OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const threads = {
  id: 'threads',
  title: 'Threads and sessions',
  operations: async () => {
    const [
      { THREAD_OPERATIONS },
      { TURN_OPERATIONS },
      { ROUTE_OPERATIONS },
      { UPDATE_WORKTREE_OPERATIONS },
      { AGENT_OPERATIONS },
      { FOLDER_OPERATIONS },
      { SEARCH_OPERATIONS },
      { COLLABORATION_OPERATIONS },
      { ATTENTION_OPERATIONS },
      { SUBSCRIPTION_OPERATIONS },
      { RECAP_OPERATIONS },
      { PIN_OPERATIONS },
      { NOTE_OPERATIONS },
      { REFUSAL_WORDS },
    ] = await Promise.all([
      import('./operations/catalog.js'),
      import('./operations/turns.js'),
      import('./operations/routes.js'),
      import('./operations/updateWorktree.js'),
      import('./operations/agents.js'),
      import('./operations/folders.js'),
      import('./operations/search.js'),
      import('./operations/collaboration.js'),
      import('./operations/attention.js'),
      import('./operations/subscriptions.js'),
      import('./operations/recap.js'),
      import('./operations/pins.js'),
      import('./operations/notes.js'),
      import('./refusalWords.js'),
    ]);
    return {
      declarations: mergeOperations(
        TURN_OPERATIONS,
        ROUTE_OPERATIONS,
        UPDATE_WORKTREE_OPERATIONS,
        AGENT_OPERATIONS,
        THREAD_OPERATIONS,
        FOLDER_OPERATIONS,
        SEARCH_OPERATIONS,
        COLLABORATION_OPERATIONS,
        ATTENTION_OPERATIONS,
        SUBSCRIPTION_OPERATIONS,
        RECAP_OPERATIONS,
        PIN_OPERATIONS,
        NOTE_OPERATIONS,
      ),
      refusals: REFUSAL_WORDS,
    } as const;
  },
} as const satisfies OperationManifest;
