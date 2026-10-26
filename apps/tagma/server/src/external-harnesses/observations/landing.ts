import type { HarnessAccepted } from '../contract/service/observations.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import {
  HARNESS_DIAGNOSTIC_LIMIT,
  HARNESS_SEEN_LIMIT,
  type HarnessBinding,
  type HarnessObservation,
  type HarnessReceipt,
} from '../../threads/contract/wire/harness/observation.js';
import { sameBinding, type Landed } from './binding.js';

export function written(facet: ExternalSession, base: HarnessObservation, landed: Landed): HarnessAccepted {
  const binding: HarnessBinding = {
    sessionId: facet.session?.id ?? null,
    execution: facet.execution,
    rootKey: landed.rootKey,
    workKey: landed.workKey,
  };
  const fresh = landed.refusals.filter((refusal, index) => {
    const previous = index === 0 ? base.diagnostics.at(-1) : landed.refusals[index - 1];
    return previous === undefined || previous.cause !== refusal.cause || previous.detail !== refusal.detail;
  });
  const diagnostics = fresh.length === 0 ? base.diagnostics : [...base.diagnostics, ...fresh].slice(-HARNESS_DIAGNOSTIC_LIMIT);
  const through = landed.through ?? base.through;
  const moved =
    landed.model !== base.metadata.model ||
    diagnostics !== base.diagnostics ||
    through !== base.through ||
    !sameBinding(binding, base.binding);
  const seen = landed.receipt !== null ? [...(facet.seen ?? []), landed.receipt].slice(-HARNESS_SEEN_LIMIT) : facet.seen;
  const sessionKey = landed.rootKey !== null && landed.rootKey !== base.binding.rootKey ? landed.rootKey : facet.sessionKey;
  const revision = moved ? base.revision + 1 : base.revision;
  const outcome: HarnessReceipt['outcome'] = landed.outcome === 'admitted' && !moved ? 'unchanged' : landed.outcome;
  const receipt: HarnessReceipt = {
    outcome,
    revision,
    cause: landed.refusals.at(-1)?.cause ?? null,
    harness: facet.name,
    transport: 'terminal',
  };
  if (!moved && seen === facet.seen) {
    return { facet: base === facet.observation ? facet : { ...facet, observation: base }, receipt };
  }
  return {
    facet: {
      ...facet,
      sessionKey,
      seen,
      observation: {
        ...base,
        binding,
        revision,
        metadata: { ...base.metadata, model: landed.model },
        diagnostics,
        through,
      },
    },
    receipt,
  };
}
