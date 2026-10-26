import { Effect, Option } from 'effect';
import type { ProcessEnding as Ending, ProcessTarget } from '@runlith/executions/protocol/stop';
import { sameProcess, sameScope, type EvidenceScope } from '@runlith/executions/protocol/evidence';
import { climb } from '@runlith/executions/stopLadder';
import type { StopStep } from '@runlith/executions/protocol/call';
import { Processes } from './ProcessReader';
import { ProcessControl } from './ProcessControl';
import { killStray } from './strayProcesses';

export const endProcess = Effect.fnUntraced(function* ({
  scope,
  target,
}: {
  readonly scope: EvidenceScope;
  readonly target: ProcessTarget;
}): Effect.fn.Return<Ending> {
  const refuse = (reason: Extract<Ending, { _tag: 'Refused' }>['reason'], detail: string, steps: readonly StopStep[] = []): Ending => ({
    _tag: 'Refused',
    target,
    reason,
    detail,
    steps,
  });
  if (!sameScope(target.scope, scope)) return refuse('scope-mismatch', 'the process belongs to another machine namespace');
  const reader = Option.getOrUndefined(yield* Effect.serviceOption(Processes));
  if (reader === undefined) return refuse('identity-unproven', 'a process reader is required');
  const signal = killStray(Option.getOrUndefined(yield* Effect.serviceOption(ProcessControl)));
  let failure: { reason: Extract<Ending, { _tag: 'Refused' }>['reason']; detail: string } | undefined;
  const standing = Effect.sync(() => {
    if (failure !== undefined) return false;
    const read = reader.identity(target.identity.pid);
    if (read._tag === 'Gone') return false;
    if (read._tag === 'Unreadable') {
      failure = { reason: 'unreadable', detail: read.detail };
      return false;
    }
    if (!sameProcess(read, target.identity)) {
      failure = { reason: 'identity-changed', detail: 'the pid now holds another process; the replacement was not signalled' };
      return false;
    }
    return !read.zombie;
  });
  const result = yield* climb('terminate', [
    {
      gone: Effect.map(standing, (alive) => !alive),
      send: Effect.fnUntraced(function* (step) {
        if (!(yield* standing)) return;
        if (!(yield* signal(target.identity, step)))
          failure = { reason: 'signal-failed', detail: `the operating system did not accept ${step} for this process` };
      }),
    },
  ]);
  if (failure !== undefined) return refuse(failure.reason, failure.detail, result.steps);
  return { _tag: result.endedAt[0] === undefined ? 'Survived' : 'Ended', target, steps: result.steps };
});
