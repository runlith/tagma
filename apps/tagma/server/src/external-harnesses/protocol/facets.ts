import type { ClientEvent } from '@runlith/acp/events';
import type { SessionConfigOption } from '@runlith/acp/updates';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { ProtocolRow } from './row.js';

export type Seated = { readonly facet: ExternalSession; readonly row: ProtocolRow };

const withdrawn = (row: ProtocolRow, asks: readonly (string | number)[]): ProtocolRow => {
  const gone = new Set(asks);
  return { ...row, asked: row.asked.filter((id) => !gone.has(id)) };
};

const modelOf = (options: readonly SessionConfigOption[] | null | undefined, option: string | null): string | null => {
  if (option === null || options == null) return null;
  const found = options.find((standing) => standing.id === option);
  return found?.type === 'select' ? found.currentValue : null;
};

const configuredBy = (row: ProtocolRow, options: readonly SessionConfigOption[] | null | undefined, whole: boolean): ProtocolRow => {
  const values = (options ?? []).flatMap((option) => (option.type === 'select' ? [[option.id, option.currentValue] as const] : []));
  return { ...row, configured: { ...(whole ? {} : (row.configured ?? {})), ...Object.fromEntries(values) } };
};

const reported = (facet: ExternalSession, model: string | null, at: string): ExternalSession => {
  if (model === null) return facet;
  const metadata = facet.observation.metadata;
  if (metadata.model._tag === 'Value' && metadata.model.value === model) return facet;
  return {
    ...facet,
    observation: {
      ...facet.observation,
      revision: facet.observation.revision + 1,
      metadata: {
        ...metadata,
        model: {
          _tag: 'Value',
          value: model,
          claim: 'serving',
          source: 'protocol',
          scope: { rootKey: facet.sessionKey, turnId: null },
          observedAt: at,
        },
      },
    },
  };
};

export const settledFacet = (
  facet: ExternalSession,
  events: readonly ClientEvent[],
  seat: Seated,
  modelOption: string | null,
  at: string,
): Seated => {
  let settled = seat.facet;
  let row = seat.row;
  for (const event of events) {
    switch (event._tag) {
      case 'SessionReady': {
        settled = reported(
          {
            ...settled,
            sessionKey: event.sessionId,
            observation: { ...settled.observation, binding: { ...settled.observation.binding, rootKey: event.sessionId } },
          },
          modelOf(event.setup.configOptions, modelOption),
          at,
        );
        row = configuredBy(row, event.setup.configOptions, true);
        break;
      }
      case 'ConfigChanged':
        settled = reported(settled, modelOf(event.configOptions, modelOption), at);
        row = configuredBy(row, event.configOptions, false);
        break;
      case 'Uncertain':
        row = withdrawn(
          row,
          event.asks.map((ask) => ask.id),
        );
        break;
      case 'Withdrawn':
        row = withdrawn(
          row,
          event.asks.map((ask) => ask.id),
        );
        break;
    }
  }
  return settled === facet && row === seat.row ? seat : { facet: settled, row };
};
