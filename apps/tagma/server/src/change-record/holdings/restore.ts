import { Effect } from 'effect';
import { stepsIn } from '@runlith/utils/sequenceDiff';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { restoreFold, type Content, type Restored, type Unknown } from '../lines/folding.js';
import type { Proven, Verdict } from '../lines/projection.js';
import { prepareAt, probeAt, type Checkout, type InputReaders, type Probe } from './inputs.js';
import type { Folder } from './judge.js';

export type Restoring =
  | { readonly kind: 'unread'; readonly cause: string }
  | { readonly kind: 'unproven'; readonly verdict: Verdict }
  | { readonly kind: 'folded'; readonly verdict: Proven; readonly restored: Restored | Unknown; readonly working: Content };

const RESTORE_STEPS = 2_000_000;

export const restoreAt = Effect.fn('Holdings.restore')(function* (
  readers: InputReaders,
  folder: Folder,
  checkout: Checkout,
  path: string,
  selected: ReadonlySet<string>,
): Effect.fn.Return<Restoring, StoreFailure> {
  const probed = yield* probeAt(readers, checkout, [path], { scope: 'required' });
  const probe = probed.probes.get(path) as Probe;
  const read = yield* prepareAt(readers, checkout, [probe], 'now');
  const one = read.get(path);
  if (one === undefined) return { kind: 'unread', cause: 'the inputs answered nothing for the path' };
  const folded = yield* Effect.result(folder(one.input, undefined, undefined, 'now'));
  if (folded._tag === 'Failure') return { kind: 'unread', cause: folded.failure.reason };
  const { working, result } = folded.success;
  if (working === null || result.verdict === 'unknown') return { kind: 'unproven', verdict: result };
  return {
    kind: 'folded',
    verdict: result,
    restored: restoreFold(working, selected, stepsIn(RESTORE_STEPS), one.input.working),
    working: one.input.working,
  };
});
