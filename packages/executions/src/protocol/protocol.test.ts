import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { ByteCursor, ByteOffset } from './record';
import { CallDecisionAnswer, CancellationCause, DeclaredCancellationCause, STOP_LADDER_MS } from './call';
import { shutdownMsOf } from './capacity';
import { ExecutionState } from './execution';
import { Refusal, UncertainEffect } from './host';
import { ScreenUnavailable } from './presentation';
import { ForegroundRefusal } from './terminal';
import { HostAnswer } from './wire';

const ref = { installation: 'inst-1', execution: 'exec-1', incarnation: 3 } as const;
const operation = { installation: 'inst-1', operation: 'op-1' } as const;
const sources = {
  stdout: { completed: true, offset: '4096' },
  stderr: { completed: true, offset: '0' },
} as const;

const roundTrip = <S extends Schema.Codec<unknown, unknown, never, never>>(schema: S, value: unknown) =>
  Schema.decodeUnknownSync(schema)(JSON.parse(JSON.stringify(Schema.encodeUnknownSync(schema)(value))));

describe('call results keep the policy decision apart from the native exit', () => {
  test('a timeout beside exit zero survives the wire as both facts', () => {
    const result = roundTrip(CallDecisionAnswer, {
      _tag: 'Decided',
      decision: { _tag: 'Cancelled', operation, execution: ref, sequence: 2, cause: 'timeout', trigger: 'deadline' },
      nativeExit: { _tag: 'Code', code: 0 },
      sources,
      cleanup: 'complete',
      retention: 'retained',
      cost: { _tag: 'Measured', cpuMicros: 67_825, peakRssBytes: 2_015_232 },
    });
    expect(result._tag).toBe('Decided');
    if (result._tag !== 'Decided') return;
    expect(result.decision._tag).toBe('Cancelled');
    expect(result.decision._tag === 'Cancelled' && result.decision.cause).toBe('timeout');
    expect(result.nativeExit).toEqual({ _tag: 'Code', code: 0 });
  });

  test('a completion by signal carries the signal as native evidence, not as a cancellation', () => {
    const result = roundTrip(CallDecisionAnswer, {
      _tag: 'Decided',
      decision: { _tag: 'Completed', operation, execution: ref, sequence: 1 },
      nativeExit: { _tag: 'Signal', signal: 'SIGTERM' },
      sources,
      cleanup: 'complete',
      retention: 'retained',
      cost: { _tag: 'Measured', cpuMicros: 4_637, peakRssBytes: 1_212_416 },
    });
    if (result._tag !== 'Decided') throw new Error(result._tag);
    expect(result.decision._tag).toBe('Completed');
    expect(result.nativeExit).toEqual({ _tag: 'Signal', signal: 'SIGTERM' });
  });

  test('a cancellation with no observed exit carries no exit, and one before any execution names only its operation', () => {
    const observed = roundTrip(CallDecisionAnswer, {
      _tag: 'Decided',
      decision: { _tag: 'Cancelled', operation, execution: ref, sequence: 4, cause: 'caller-lost', trigger: 'custodian' },
      nativeExit: undefined,
      sources: { stdout: { completed: false, offset: '10' }, stderr: { completed: false, offset: '0' } },
      cleanup: 'unverifiable',
      retention: 'partial',
      cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'no exit was observed' },
    });
    if (observed._tag !== 'Decided') throw new Error(observed._tag);
    expect('nativeExit' in observed).toBe(false);
    expect(Schema.decodeUnknownSync(CallDecisionAnswer)({ ...observed, nativeExit: undefined })).toEqual(observed);

    const early = roundTrip(CallDecisionAnswer, {
      _tag: 'Decided',
      decision: { _tag: 'Cancelled', operation, execution: undefined, sequence: 0, cause: 'run-abort', trigger: 'op-1' },
      sources: { stdout: { completed: false, offset: '0' }, stderr: { completed: false, offset: '0' } },
      cleanup: 'complete',
      retention: 'lost',
      cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'no execution was started' },
    });
    if (early._tag !== 'Decided' || early.decision._tag !== 'Cancelled') throw new Error(early._tag);
    expect('execution' in early.decision).toBe(false);
  });

  test('an unavailable result keeps its last known decision and never gains an exit', () => {
    const result = roundTrip(CallDecisionAnswer, {
      _tag: 'Unavailable',
      operation,
      execution: ref,
      lastKnown: { _tag: 'Cancelled', operation, execution: ref, sequence: 2, cause: 'shutdown', trigger: 'host' },
      reason: 'store lost',
    });
    expect(result._tag).toBe('Unavailable');
    if (result._tag !== 'Unavailable') return;
    expect(result.lastKnown?._tag).toBe('Cancelled');
    const smuggled = Schema.decodeUnknownSync(CallDecisionAnswer)({ ...result, nativeExit: { _tag: 'Code', code: 0 } });
    expect('nativeExit' in smuggled).toBe(false);
  });
});

describe('what a caller may declare is the port union minus the host own causes', () => {
  test('every cause but the host own decodes, and exactly one is withheld', () => {
    const decode = Schema.decodeUnknownResult(DeclaredCancellationCause);
    for (const cause of CancellationCause.literals) {
      expect(decode(cause)._tag).toBe(cause === 'not-started' ? 'Failure' : 'Success');
    }
    expect(DeclaredCancellationCause.literals.length).toBe(CancellationCause.literals.length - 1);
  });
});

describe('cursors and outcomes cross a JSON door unchanged', () => {
  test('a byte offset past 2^53 comes back as the byte it named', () => {
    const cursor = roundTrip(ByteCursor, { ref, stream: 'pty', offset: '9007199254740993' });
    expect(String(cursor.offset)).toBe('9007199254740993');
  });

  test('an offset that is not a canonical decimal is refused', () => {
    const decode = Schema.decodeUnknownResult(ByteOffset);
    for (const spelling of ['007', '-1', '1e3', '12.5', '', ' 42']) {
      expect(decode(spelling)._tag).toBe('Failure');
    }
  });

  test('a refusal, an uncertain effect and a state keep their tags and missing facts', () => {
    const refused = roundTrip(Refusal, { _tag: 'IncarnationMismatch', reason: 'incarnation 2 retired' });
    expect(refused._tag).toBe('IncarnationMismatch');

    const uncertain = roundTrip(UncertainEffect, {
      _tag: 'StoreFailed',
      operation,
      phase: 'starting',
      cleanup: 'owned',
      reason: 'carrier exited',
    });
    expect(uncertain._tag).toBe('StoreFailed');
    expect('execution' in uncertain).toBe(false);

    const state = roundTrip(ExecutionState, {
      ref,
      transport: 'pty',
      lifetime: 'held',
      purpose: 'command',
      phase: 'running',
      streams: { stdout: 'open', stderr: 'open', pty: 'open' },
      cleanup: 'pending',
      record: 'available',
    });
    expect('nativeExit' in state).toBe(false);
  });
});

describe('a screen unavailability carries the source ending as its own field', () => {
  const through = ByteOffset.make('0');

  test('a subscription stop keeps its ending beside closed, and an interpreter failure carries none', () => {
    const stopped = roundTrip(ScreenUnavailable, {
      _tag: 'ScreenUnavailable',
      ref,
      parsedThrough: through,
      reason: 'closed',
      ending: 'completed',
      detail: 'this screen subscription ended: completed',
    });
    expect(stopped.reason).toBe('closed');
    expect(stopped.ending).toBe('completed');

    const cancelled = roundTrip(ScreenUnavailable, {
      _tag: 'ScreenUnavailable',
      ref,
      parsedThrough: through,
      reason: 'closed',
      ending: 'cancelled',
      detail: 'this screen subscription ended: cancelled',
    });
    expect(cancelled.ending).toBe('cancelled');
    expect(cancelled.ending).not.toBe(stopped.ending);

    const gone = roundTrip(ScreenUnavailable, {
      _tag: 'ScreenUnavailable',
      ref,
      parsedThrough: through,
      reason: 'engine',
      detail: 'the interpreter stopped',
    });
    expect(gone.reason).toBe('engine');
    expect('ending' in gone).toBe(false);
  });
});

test('foreground refusals retain their condition and detail through the host answer wire', () => {
  for (const reason of ['no-terminal', 'unsupported', 'unreadable'] as const) {
    const outcome = ForegroundRefusal.make({ reason, detail: `foreground ${reason}` });
    expect(roundTrip(HostAnswer, { _tag: 'Foreground', outcome })).toEqual({
      _tag: 'Foreground',
      outcome: { _tag: 'ForegroundRefused', reason, detail: `foreground ${reason}` },
    });
  }
});

describe('one shutdown is bounded by the ladder its endings go down', () => {
  test('an undeclared bound holds one whole ladder, its reap wait, the ending reads and the phases', () => {
    expect(shutdownMsOf(undefined)).toBe(STOP_LADDER_MS + 3100 + 2000);
  });

  test('a declared bound stands as the installation measured it', () => {
    expect(shutdownMsOf(5000)).toBe(5000);
  });
});
