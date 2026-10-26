import {
  type HarnessBinding,
  type HarnessField,
  type HarnessLastKnown,
  type HarnessObservation,
  type HarnessStale,
  unmeasuredObservation,
} from '../../threads/contract/wire/harness/observation.js';

export const observationRebound = (standing: HarnessObservation, binding: HarnessBinding): HarnessObservation => {
  const fresh = unmeasuredObservation();
  return {
    ...fresh,
    binding,
    revision: standing.revision + 1,
    metadata: {
      model: staleField(standing.metadata.model, 'authority-lapsed'),
      effort: staleField(standing.metadata.effort, 'authority-lapsed'),
      title: staleField(standing.metadata.title, 'authority-lapsed'),
    },
  };
};

export const staleField = (field: HarnessField, why: HarnessStale): HarnessField => {
  const last = lastKnownOf(field);
  return last === null ? { _tag: 'NotRead' } : { _tag: 'Stale', lastKnown: { ...last, why } };
};

export const lastKnownOf = (field: HarnessField): HarnessLastKnown | null => {
  switch (field._tag) {
    case 'Value':
      return {
        value: field.value,
        claim: field.claim,
        source: field.source,
        scope: field.scope,
        observedAt: field.observedAt,
        why: 'authority-lapsed',
      };
    case 'Stale':
      return field.lastKnown;
    case 'Unreadable':
      return field.lastKnown;
    default:
      return null;
  }
};
