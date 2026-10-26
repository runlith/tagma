import { Effect } from 'effect';
import { finishBlocks, planBlocks, type BlockSettlement, type SettlementAnswer, type SettlementJob } from './settling.js';

declare const self: Worker;

let plan: BlockSettlement | null = null;
const answer = Effect.fnUntraced(function* (job: SettlementJob): Effect.fn.Return<SettlementAnswer> {
  if (job.phase === 'plan') {
    plan = yield* planBlocks(job.files);
    if (plan === null) return { state: 'settled', settled: null };
    if (plan.joining.length === 0) return { state: 'settled', settled: yield* finishBlocks(plan, []) };
    return { state: 'merge', sides: plan.joining.map(({ sides }) => sides) };
  }
  if (plan === null) return yield* Effect.die('the settlement worker received merged texts before a plan');
  return { state: 'settled', settled: yield* finishBlocks(plan, job.merged) };
});

self.onmessage = (event: MessageEvent<SettlementJob>) => {
  Effect.runPromise(answer(event.data)).then(
    (answer) => self.postMessage(answer),
    (failure) => {
      throw failure;
    },
  );
};
self.postMessage({ state: 'ready' } satisfies SettlementAnswer);
