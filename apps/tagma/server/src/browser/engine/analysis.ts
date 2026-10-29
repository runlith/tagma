import { Cause, Data, Effect, Queue, Schema, Semaphore } from 'effect';
import type { TraceSummary } from '../contract/wire/trace.js';
import { AnalysisAnswer, type AnalysisAsk } from './sidecar.js';

export class AnalysisFailed extends Data.TaggedError('AnalysisFailed')<{ readonly message: string }> {}

export type Analysis = { readonly analyze: (ask: Omit<AnalysisAsk, 'id'>) => Effect.Effect<TraceSummary, AnalysisFailed> };

const failed = (message: string) => new AnalysisFailed({ message: `the trace was not analyzed: ${message}` });

const spawned = Effect.acquireRelease(
  Effect.try({
    try: () => new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }),
    catch: (cause) => failed(`its worker did not start: ${String(cause)}`),
  }),
  (worker) => Effect.sync(() => worker.terminate()),
);

export const makeAnalysis = Effect.fnUntraced(function* () {
  const turn = yield* Semaphore.make(1);
  let asked = 0;

  const analyzed = Effect.fnUntraced(function* (ask: AnalysisAsk) {
    const worker = yield* spawned;
    const answers = yield* Queue.unbounded<AnalysisAnswer, AnalysisFailed>();
    const refuse = (message: string) => Queue.failCauseUnsafe(answers, Cause.fail(failed(message)));
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const decoded = Schema.decodeUnknownResult(AnalysisAnswer)(event.data);
      if (decoded._tag === 'Success') Queue.offerUnsafe(answers, decoded.success);
      else refuse('its worker answered unreadably');
    });
    worker.addEventListener('error', (event: ErrorEvent) => refuse(`its worker failed: ${event.message || String(event.error)}`));
    worker.addEventListener('close', () => refuse('its worker closed'));
    for (;;) {
      const answer = yield* Queue.take(answers);
      if ('ready' in answer) {
        worker.postMessage(ask);
        continue;
      }
      if (answer.id !== ask.id) continue;
      return 'failed' in answer ? yield* failed(answer.failed) : answer.summary;
    }
  }, Effect.scoped);

  return {
    analyze: Effect.fn('Traces.analyze')(function* (ask) {
      asked += 1;
      return yield* turn.withPermits(1)(analyzed({ ...ask, id: asked }));
    }),
  } satisfies Analysis;
});
