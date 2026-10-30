import { Effect } from 'effect';
import type { SessionLookupStore } from '../threads/store/sessionLookups.js';
import { NotesReach } from '../threads/contract/service/notes.js';
import { promptSupported } from './adapter/hookFormat.js';
import type { HarnessAdapters } from './contract/service/adapters.js';
import type { HarnessSessionStore } from './store/sessions.js';

export const notesReach = (lookups: SessionLookupStore['Service'], store: HarnessSessionStore, adapters: HarnessAdapters['Service']) =>
  NotesReach.of({
    withheld: Effect.fnUntraced(function* (threadId: string) {
      const born = yield* lookups.harnessOf(threadId);
      if (born === undefined || born === null) return null;
      if ((yield* store.binding(threadId))?.adapter === 'acp') return null;
      const adapter = adapters.running(born);
      if (adapter === null || promptSupported(adapter.hooks)) return null;
      return `${adapter.label} in a terminal takes no measured answer to its prompt hook, so these notes do not reach its model.`;
    }),
  });
