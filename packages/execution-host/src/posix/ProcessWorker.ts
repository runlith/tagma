import { Data, Deferred, Effect, Exit, Scope, Semaphore } from 'effect';
import type { WorkState } from '../holder/Holder';
import type { ProcessProbe, ProcessReading, ProcessRow } from '../ProcessReader';
import type { UsageDemand, UsageRead } from '../UsageReader';
import type { Refused } from './refusal';
import type { Answer, Question, Request } from './ProcessServer';

export class WorkerUnanswered extends Data.TaggedError('WorkerUnanswered')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

type ProcessWorker = {
  readonly machineName: string;
  readonly usage: (demand: UsageDemand) => Effect.Effect<UsageRead, WorkerUnanswered>;
  readonly scan: (probe: ProcessProbe) => Effect.Effect<ReadonlyArray<ProcessRow> | Refused, WorkerUnanswered>;
  readonly facts: (pids: ReadonlyArray<number>) => Effect.Effect<ProcessReading | Refused, WorkerUnanswered>;
  readonly group: (work: number, leader: number, exited: boolean) => Effect.Effect<WorkState | Refused, WorkerUnanswered>;
  readonly lost: () => boolean;
};

type Replied = Exclude<Answer, { readonly _tag: 'Ready' | 'Opened' | 'Refused' }>;

type Settle = (answer: Replied | WorkerUnanswered) => void;

export const openProcessWorker = Effect.fn('posix.ProcessWorker.open')(function* (
  path: string,
  spawn: () => Worker,
): Effect.fn.Return<ProcessWorker, WorkerUnanswered, Scope.Scope> {
  const opened = yield* Deferred.make<string, WorkerUnanswered>();
  const waiting = new Map<number, Settle>();
  let next = 0;
  let lost: WorkerUnanswered | undefined;
  const end = (worker: Worker, reason: WorkerUnanswered): void => {
    if (lost !== undefined) return;
    lost = reason;
    worker.terminate();
    Deferred.doneUnsafe(opened, Effect.fail(reason));
    const settles = [...waiting.values()];
    waiting.clear();
    for (const settle of settles) settle(reason);
  };
  const worker = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const worker = spawn();
      worker.onerror = (event) => end(worker, new WorkerUnanswered({ detail: `the process worker failed: ${event.message}` }));
      worker.addEventListener('close', () => end(worker, new WorkerUnanswered({ detail: 'the process worker ended' })));
      worker.onmessage = (event: MessageEvent<Answer>) => {
        const answer = event.data;
        if (answer._tag === 'Ready') return worker.postMessage({ _tag: 'Open', path } satisfies Request);
        if (answer._tag === 'Opened') return void Deferred.doneUnsafe(opened, Effect.succeed(answer.machineName));
        if (answer._tag === 'Refused') return end(worker, new WorkerUnanswered({ detail: answer.detail }));
        const settle = waiting.get(answer.id);
        waiting.delete(answer.id);
        settle?.(answer);
      };
      return worker;
    }),
    (worker) => Effect.sync(() => end(worker, new WorkerUnanswered({ detail: 'the process worker was closed' }))),
  );
  const machineName = yield* Deferred.await(opened);
  const asked = <A>(question: Question, take: (answer: Replied) => A | undefined): Effect.Effect<A, WorkerUnanswered> =>
    Effect.callback<A, WorkerUnanswered>((resume) => {
      if (lost !== undefined) return resume(Effect.fail(lost));
      const id = (next += 1);
      waiting.set(id, (answer) => {
        if (answer instanceof WorkerUnanswered) return resume(Effect.fail(answer));
        if (answer._tag === 'Failed') return resume(Effect.fail(new WorkerUnanswered({ detail: answer.detail })));
        const reply = take(answer);
        resume(
          reply === undefined
            ? Effect.fail(new WorkerUnanswered({ detail: `the process worker answered ${question._tag} with ${answer._tag}` }))
            : Effect.succeed(reply),
        );
      });
      worker.postMessage({ _tag: 'Ask', id, question } satisfies Request);
      return Effect.sync(() => void waiting.delete(id));
    });
  return {
    machineName,
    usage: (demand) => asked({ _tag: 'Usage', demand }, (answer) => (answer._tag === 'Usage' ? answer.reply : undefined)),
    scan: (probe) => asked({ _tag: 'Scan', probe }, (answer) => (answer._tag === 'Scan' ? answer.reply : undefined)),
    facts: (pids) => asked({ _tag: 'Facts', pids }, (answer) => (answer._tag === 'Facts' ? answer.reply : undefined)),
    group: (work, leader, exited) =>
      asked({ _tag: 'Group', work, leader, exited }, (answer) => (answer._tag === 'Group' ? answer.reply : undefined)),
    lost: () => lost !== undefined,
  };
});

type HeldWorker = { readonly worker: ProcessWorker; readonly scope: Scope.Closeable };

export const leaseProcessWorker = Effect.fnUntraced(function* (
  path: string,
  spawn: () => Worker,
): Effect.fn.Return<Effect.Effect<ProcessWorker, WorkerUnanswered>, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  const opening = yield* Semaphore.make(1);
  let held: HeldWorker | undefined;
  const current = () => held;
  return opening.withPermit(
    Effect.gen(function* () {
      const standing = current();
      if (standing !== undefined && !standing.worker.lost()) return standing.worker;
      if (standing !== undefined) yield* Scope.close(standing.scope, Exit.void);
      const own = yield* Scope.fork(scope);
      const opened = yield* openProcessWorker(path, spawn).pipe(
        Scope.provide(own),
        Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(own, exit) : Effect.void)),
      );
      held = { worker: opened, scope: own };
      return opened;
    }),
  );
});
