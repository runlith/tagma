import { Context, type Effect } from 'effect';
import type { ConnectorEntry } from '../wire/entry.js';

export class ConnectorCatalog extends Context.Service<ConnectorCatalog, { readonly entries: Effect.Effect<readonly ConnectorEntry[]> }>()(
  'tagma/connectors/ConnectorCatalog',
) {}
