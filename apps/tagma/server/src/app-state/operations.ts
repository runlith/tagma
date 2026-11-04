import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { Documents } from './contract/service/documents.js';
import { APP_STATE_OPERATIONS as OPS, type AppStateOperationId } from './contract/wire/documents.js';

export const APP_STATE_PAIRS: { readonly [K in AppStateOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_app_state: pair(
    OPS.read_app_state,
    body(OPS.read_app_state, {
      execute: () =>
        Effect.map(
          Effect.flatMap(Documents, (documents) => documents.read),
          (set) => ({ status: 'read' as const, ...set }),
        ),
    }),
  ),
  write_app_state: pair(
    OPS.write_app_state,
    body(OPS.write_app_state, {
      execute: (input) =>
        Effect.map(
          Effect.flatMap(Documents, (documents) => documents.write(input)),
          (revision) => ({ status: 'written' as const, revision }),
        ),
    }),
  ),
};
