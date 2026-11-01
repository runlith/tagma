import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { Content, RestoreResult, Unknown } from '../lines/folding.js';
import type { Proven, Verdict } from '../lines/projection.js';
import { prepareAt, probeAt, type Checkout, type InputReaders, type Probe } from './inputs.js';

export type Restoring =
  | { readonly kind: 'unread'; readonly cause: string }
  | { readonly kind: 'unproven'; readonly verdict: Verdict }
  | { readonly kind: 'folded'; readonly verdict: Proven; readonly restored: RestoreResult | Unknown; readonly working: Content };

export const restoreAt = Effect.fn('Holdings.restore')(function* (
  readers: InputReaders,
  checkout: Checkout,
  path: string,
  selected: ReadonlySet<string>,
): Effect.fn.Return<Restoring, StoreFailure> {
  const probed = yield* probeAt(readers, checkout, [path], { scope: 'required' });
  const probe = probed.probes.get(path) as Probe;
  const read = yield* prepareAt(readers, checkout, [probe], 'now');
  const one = read.get(path);
  if (one === undefined) return { kind: 'unread', cause: 'the inputs answered nothing for the path' };
  const folded = yield* Effect.result(readers.walks.restore(one.input, selected, 'now'));
  if (folded._tag === 'Failure') return { kind: 'unread', cause: folded.failure.reason };
  const { restored, result } = folded.success;
  if (restored === null || result.verdict === 'unknown') return { kind: 'unproven', verdict: result };
  return {
    kind: 'folded',
    verdict: result,
    restored,
    working: one.input.working,
  };
});
