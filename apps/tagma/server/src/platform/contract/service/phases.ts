import { Context, Effect } from 'effect';
import type { PhaseStamp } from '../wire/phases.js';

export type PhaseCapture = { readonly status: 'observed' | 'unobserved' } | { readonly status: 'unavailable'; readonly detail: string };

export const PhaseEvents = Context.Reference<(stamp: PhaseStamp) => Effect.Effect<PhaseCapture>>('tagma/platform/PhaseEvents', {
  defaultValue: () => () => Effect.succeed({ status: 'unobserved' }),
});
