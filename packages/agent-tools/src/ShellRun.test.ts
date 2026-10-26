import { describe, expect, it } from 'bun:test';
import type { CallDecisionAnswer, CancellationCause } from '@runlith/executions/protocol/call';
import type { ExecutionRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import { endingOf, settleManaged } from './ShellRun';

const operation = { installation: 'install-1', operation: 'op-1' } as HostRequestRef;
const execution = { installation: 'install-1', execution: 'exec-1', incarnation: 1 } as ExecutionRef;

const cancelled = (cause: CancellationCause, trigger: string): CallDecisionAnswer => ({
  _tag: 'Decided',
  decision: { _tag: 'Cancelled', operation, execution, sequence: 0, cause, trigger },
  sources: { stdout: { completed: true, offset: '0' as never }, stderr: { completed: true, offset: '0' as never } },
  cleanup: 'complete',
  retention: 'retained',
  cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'the case measures no child' },
});

describe('a command that was admitted and never started', () => {
  it('is answered as never started, with the holder reason, and not as a deadline or a stop', () => {
    const settled = settleManaged(cancelled('not-started', 'queued 2000ms behind 6 of 6 slots granted'), 'owner');
    expect(settled.notStarted).toBe('queued 2000ms behind 6 of 6 slots granted');
    expect(settled.expired).toBe(false);
    expect(settled.stopped).toBeNull();
    expect(settled.aborted).toBe(false);
    expect(settled.code).toBeNull();
    expect(endingOf(settled)).toEqual({
      _tag: 'Unknown',
      detail: 'it never started: queued 2000ms behind 6 of 6 slots granted',
    });
  });

  it('leaves a deadline a deadline: work that ran and was killed still reads as expired', () => {
    const settled = settleManaged(cancelled('timeout', 'deadline at 1 (revision 0)'), 'owner');
    expect(settled.expired).toBe(true);
    expect(settled.notStarted).toBeNull();
  });
});

describe('a command whose leader exited while something it started outlived it', () => {
  const undecided: CallDecisionAnswer = {
    _tag: 'Undecided',
    operation,
    execution,
    nativeExit: { _tag: 'Code', code: 0 },
    sources: { stdout: { completed: false, offset: '12' as never }, stderr: { completed: false, offset: '0' as never } },
    cleanup: 'pending',
    retention: 'retained',
    cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'the case measures no child' },
  };

  it('answers the exit the kernel reported, and never as an unconfirmed ending', () => {
    const settled = settleManaged(undecided, 'owner');
    expect(settled.code).toBe(0);
    expect(settled.unconfirmed).toBeNull();
    expect(endingOf(settled)).toEqual({ _tag: 'Code', code: 0 });
    expect(settled.expired).toBe(false);
    expect(settled.aborted).toBe(false);
    expect(settled.stopped).toBeNull();
    expect(settled.notStarted).toBeNull();
  });

  it('discloses what outlived the command, naming the sources it still holds open', () => {
    const settled = settleManaged(undecided, 'owner');
    const outlived = settled.disclosed.filter((line) => line.includes('outlived'));
    expect(outlived).toHaveLength(1);
    expect(outlived[0]).toContain('stdout and stderr');
  });
});
