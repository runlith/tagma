import { harnessRoot } from '../contract/service/table.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import {
  harnessBindingSchema,
  type HarnessBinding,
  type HarnessDiagnostic,
  type HarnessEvent,
  type HarnessField,
  type HarnessLastKnown,
  type HarnessObservation,
  type HarnessStale,
} from '../../threads/contract/wire/harness/observation.js';
import type { HarnessProvenance } from '@runlith/tagma/adapter/harness';
import { lastKnownOf, staleField } from './staleness.js';

export type Landed = {
  readonly model: HarnessField;
  readonly refusals: readonly HarnessDiagnostic[];
  readonly rootKey: string | null;
  readonly workKey: string | undefined;
  readonly receipt: string | null;
  readonly through?: string | undefined;
  readonly outcome: 'admitted' | 'kept' | 'refused';
};

export const rootOf = (
  facet: ExternalSession,
  base: HarnessObservation,
  event: HarnessEvent,
  proven: boolean,
): 'unproven' | 'binding' | 'proven' | 'foreign' => {
  if (event.rootKey === null) return 'unproven';
  const bound = base.binding.rootKey;
  if (bound !== null) return bound === event.rootKey ? 'proven' : 'foreign';
  if (!proven) return 'unproven';
  const expected = facet.session?.cut?.into ?? harnessRoot(facet.name, facet.session?.argv ?? null);
  return expected === null ? 'unproven' : expected === event.rootKey ? 'binding' : 'foreign';
};

export const workBound = (
  facet: ExternalSession,
  base: HarnessObservation,
  event: HarnessEvent,
  proven: boolean,
  root: ReturnType<typeof rootOf>,
): 'unproven' | 'binding' | 'proven' | 'foreign' => {
  if (root !== 'unproven') return 'proven';
  if (event.rootKey === null) return 'unproven';
  const bound = base.binding.workKey;
  if (bound !== undefined) return bound === event.rootKey ? 'proven' : 'foreign';
  if (!proven || event.occasion !== 'session-start') return 'unproven';
  return harnessRoot(facet.name, facet.session?.argv ?? null) === null ? 'binding' : 'unproven';
};

export const sourceOf = (field: HarnessField): HarnessProvenance | null =>
  field._tag === 'NotRead' ? null : field._tag === 'Stale' ? field.lastKnown.source : field.source;

export const refreshed = (standing: HarnessField, reported: HarnessField): HarnessField => {
  if (reported._tag !== 'Unreadable' || reported.lastKnown !== null) return reported;
  const last = lastKnownOf(standing);
  return last === null ? reported : { ...reported, lastKnown: { ...last, why: 'refresh-failed' } };
};

export const bindingOf = (facet: ExternalSession, standing: HarnessObservation): HarnessBinding => ({
  sessionId: facet.session?.id ?? null,
  execution: facet.execution,
  rootKey: standing.binding.rootKey,
  workKey: standing.binding.workKey,
});

const bindingScalars = Object.keys(harnessBindingSchema.fields)
  .filter((field) => field !== 'execution')
  .sort();

export const sameBinding = (left: HarnessBinding, right: HarnessBinding): boolean =>
  bindingScalars.every((field) => (left as Record<string, unknown>)[field] === (right as Record<string, unknown>)[field]) &&
  left.execution?.execution === right.execution?.execution &&
  left.execution?.incarnation === right.execution?.incarnation;

export function sameField(left: HarnessField, right: HarnessField): boolean {
  if (left._tag !== right._tag) return false;
  if (left._tag === 'NotRead' || right._tag === 'NotRead') return true;
  if (left._tag === 'Stale' && right._tag === 'Stale') return sameLastKnown(left.lastKnown, right.lastKnown);
  if (right._tag === 'Stale' || left._tag === 'Stale') return false;
  if (left.source !== right.source || left.scope.rootKey !== right.scope.rootKey || left.scope.turnId !== right.scope.turnId) {
    return false;
  }
  if (left._tag === 'Value' && right._tag === 'Value') return left.value === right.value && left.claim === right.claim;
  if (left._tag === 'Unreadable' && right._tag === 'Unreadable') {
    return left.reason === right.reason && sameLastKnown(left.lastKnown, right.lastKnown);
  }
  return left._tag === right._tag;
}

function sameLastKnown(left: HarnessLastKnown | null, right: HarnessLastKnown | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.value === right.value &&
    left.why === right.why &&
    left.claim === right.claim &&
    left.source === right.source &&
    (left.scope?.rootKey ?? null) === (right.scope?.rootKey ?? null) &&
    (left.scope?.turnId ?? null) === (right.scope?.turnId ?? null)
  );
}

export function field(standing: HarnessField, reported: HarnessField, why: HarnessStale | null): HarnessField {
  if (reported._tag === 'NotRead') return standing;
  if (reported._tag === 'Unsupported' && standing._tag !== 'NotRead' && sourceOf(standing) !== reported.source) return standing;
  const read = refreshed(standing, reported);
  if (why === null) return read;
  return standing._tag === 'NotRead' || standing._tag === 'Stale' ? staleField(read, why) : standing;
}
