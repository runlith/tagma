import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit } from 'effect';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { ThreadRewindRefusedError } from '@runlith/agent/thread/rewind';
import { SequenceUnavailable, ThreadActReusedError, ThreadActSpentError } from '@runlith/agent/thread/transition/port';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ThreadInteractionConflictError } from '@runlith/agent/thread/run/ThreadQuestion';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import { ThreadRunConflictError, ThreadRunNotInterruptedError } from '@runlith/agent/thread/storage/runs';
import {
  ThreadCompactionConflictError,
  ThreadCompactionOffError,
  ThreadSummaryFailedError,
} from '@runlith/agent/thread/storage/compaction';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { UndeclaredRefusal } from '../platform/contract/service/routed.js';
import { harnessRefusal } from './refusals.js';
import { type HarnessFailure, ThreadInputRefused, ThreadRefused } from './contract/service/failure.js';

const door = Effect.fnUntraced(function* (failure: HarnessFailure, admitted?: readonly string[]) {
  const exit = yield* Effect.exit(harnessRefusal(Effect.fail(failure), admitted));
  if (Exit.isSuccess(exit)) return yield* Effect.die('the refusal mapping answered instead of failing');
  return { refused: Cause.hasFails(exit.cause), value: Cause.squash(exit.cause) };
});

it.effect('kernel refusals become actionable product refusals under their own codes', () =>
  Effect.gen(function* () {
    const cases: readonly (readonly [HarnessFailure, string])[] = [
      [new ThreadNotFoundError('thread-1'), 'not-found'],
      [
        new ThreadCallBroke({ cause: new ThreadInteractionConflictError({ threadId: 'thread-1', runId: 'run-1', questionId: 'q-1' }) }),
        'interaction-conflict',
      ],
      [new ThreadCompactionConflictError('thread-1'), 'compaction-conflict'],
      [new ThreadSummaryFailedError('thread-1', 'empty', 'the model produced an empty summary'), 'summary-failed'],
      [new ThreadCompactionOffError('thread-1'), 'compaction-off'],
      [
        new ThreadCallBroke({ cause: new ThreadRunNotInterruptedError({ threadId: 'thread-1', status: 'completed' }) }),
        'run-not-interrupted',
      ],
      [new ThreadCallBroke({ cause: new ThreadRunConflictError({ threadId: 'thread-1', runId: 'run-2' }) }), 'run-active'],
      [new ThreadCallBroke({ cause: new ThreadRewindRefusedError('rewind-summarized', 'thread-1', 'run-1') }), 'rewind-summarized'],
      [new ThreadCallBroke({ cause: new ThreadActReusedError({ threadId: 'thread-1', evidence: { decidedBy: 'x' } }) }), 'key-reused'],
      [new ThreadCallBroke({ cause: new ThreadActSpentError({ threadId: 'thread-1', at: 'before-epoch' }) }), 'act-spent'],
    ];
    for (const [failure, code] of cases) {
      const answer = yield* door(failure);
      expect(answer.refused).toBe(true);
      expect(answer.value).toMatchObject({ code });
    }
  }),
);

it.effect('a foreign project is named and input refusals keep their way out', () =>
  Effect.gen(function* () {
    expect((yield* door(new ThreadRefused('thread-1', 7))).value).toMatchObject({
      code: 'foreign-project',
      unblock: ['read it with project: 7'],
    });
    expect((yield* door(new ThreadInputRefused('title-empty', 'a title is empty', ['send one']))).value).toMatchObject({
      code: 'title-empty',
      unblock: ['send one'],
    });
    const refusal = new GateRefusal('unknown-project', 'that project is not registered', ['name it']);
    expect((yield* door(new ThreadCallBroke({ cause: refusal }))).value).toBe(refusal);
  }),
);

it.effect('a retired sequence is actionable both directly and through a kernel hook', () =>
  Effect.gen(function* () {
    const gone = new SequenceUnavailable('run-1', 4, 'ended');
    for (const failure of [gone, new ThreadCallBroke({ cause: gone })]) {
      const answer = yield* door(failure);
      expect(answer.refused).toBe(true);
      expect(answer.value).toBeInstanceOf(GateRefusal);
      expect(answer.value).toMatchObject({ code: 'sequence-unavailable' });
    }
  }),
);

it.effect('a storage failure is a server failure while a successful answer passes through', () =>
  Effect.gen(function* () {
    const answer = yield* door(new ThreadStorageFailed({ call: 'find', cause: new Error('database is locked') }));
    expect(answer.refused).toBe(false);
    expect(answer.value).toMatchObject({ message: 'database is locked' });
    expect(yield* harnessRefusal(Effect.succeed('ok'))).toBe('ok');
  }),
);

it.effect('operation-specific codes and shared field families are admitted, and an undeclared code remains a defect', () =>
  Effect.gen(function* () {
    for (const code of ['agent-not-found', 'no-root', 'project-retired', 'ambiguous-name']) {
      expect((yield* door(new GateRefusal(code, 'the owner refused', ['read it']), ['agent-not-found'])).refused).toBe(true);
    }
    const invented = yield* door(new GateRefusal('made-up-code', 'the owner refused', ['read it']), ['agent-not-found']);
    expect(invented.refused).toBe(false);
    expect(invented.value).toBeInstanceOf(UndeclaredRefusal);
    expect(invented.value).toMatchObject({ code: 'made-up-code' });
  }),
);
