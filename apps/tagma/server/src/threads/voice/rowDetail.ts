import { currentEffort, currentModel } from '../contract/wire/harness/observation.js';
import type { ExternalSession, HarnessRowDetail } from '../contract/wire/harness/externalSession.js';
import { harnessSessionActive } from '../contract/wire/harness/session.js';
import { harnessTransportOf, type HarnessRoad } from '../contract/wire/harness/seat.js';
import type { HarnessName } from '../contract/wire/harness/names.js';

const REPORT_QUOTE_MAX = 200;

export const capped = (flat: string): string => (flat.length <= REPORT_QUOTE_MAX ? flat : `${flat.slice(0, REPORT_QUOTE_MAX)}…`);

export const quoted = (text: string): string => capped(text.replace(/\s+/g, ' ').trim());

export const shownHarness = (facet: ExternalSession | null, road: HarnessRoad): HarnessRowDetail | null =>
  road.transport.agent === null ? wireHarness(facet, road) : null;

export const hostingCli = (facet: ExternalSession | null, road: HarnessRoad): HarnessName | null =>
  facet !== null && road.transport.agent !== null ? facet.name : null;

export const processAccount = (facet: ExternalSession | null): string | null => {
  const session = facet?.session;
  return harnessSessionActive(session) ? (session.account?.key ?? null) : null;
};

export const wireHarness = (facet: ExternalSession | null, road: HarnessRoad): HarnessRowDetail | null =>
  facet === null
    ? null
    : {
        name: facet.name,
        transport: harnessTransportOf(road.transport),
        agent: road.transport.agent,
        provider: road.provider,
        capabilities: road.capabilities,
        model: currentModel(facet.observation),
        effort: currentEffort(facet.observation),
        asked: road.model === null ? null : { model: road.model, reasoning: road.reasoning },
        execution: facet.execution,
        process:
          facet.session === undefined
            ? null
            : {
                id: facet.session.id,
                state: facet.session.state,
                startedAt: facet.session.startedAt,
                origin: facet.session.origin === 'adopted' ? ('adopted' as const) : undefined,
                failure: facet.session.failure,
              },
        observation: facet.observation,
      };
