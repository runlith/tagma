import { Effect } from 'effect';
import { PluginRevisions, RevisionRecords } from '../contract/service/plugins.js';

export const unheldRevisions = PluginRevisions.of({
  hold: () => Effect.succeed(true),
  register: () => Effect.void,
  released: Effect.void,
});

export const unrecorded = RevisionRecords.of({ recorded: Effect.succeed(new Set()) });
