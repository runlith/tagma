import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { type Git, GitNotAdmitted, GitUnavailable } from './Git.js';
import { GitUnreadable, headAt } from './repository.js';
import { workingTextsAt } from './working.js';

const failing = (failure: GitNotAdmitted | GitUnavailable): Git['Service'] => ({ run: () => Effect.fail(failure) });

const readFailure = (git: Git['Service']) => Effect.flip(headAt(git, '/repo'));

it.effect('a read git was not admitted for keeps the admission refusal, and a git that could not start does not claim one', () =>
  Effect.gen(function* () {
    const refusal = new GitNotAdmitted({
      command: ['status'],
      code: 'terminal-no-owner',
      reason: 'no live owner',
      unblock: ['name a live owner'],
    });
    const refused = yield* readFailure(failing(refusal));
    expect(refused).toBeInstanceOf(GitUnreadable);
    expect(refused._tag === 'GitUnreadable' ? refused.admission : undefined).toBe(refusal);

    const down = yield* readFailure(failing(new GitUnavailable({ command: ['status'], reason: 'no process' })));
    expect(down._tag === 'GitUnreadable' ? down.admission : 'not a reading failure').toBeUndefined();
  }),
);

it.effect('truncated index metadata is unreadable for every asked path, never successful absence', () =>
  Effect.gen(function* () {
    const git: Git['Service'] = {
      run: () =>
        Effect.succeed({
          status: 0,
          stdout: `100644 ${'a'.repeat(40)} 0\tpresent\0`,
          stderr: '',
          overflow: true,
          messageOverflow: false,
        }),
    };
    const rows = yield* workingTextsAt(git, '/repo', '', ['present', 'omitted']);
    expect(rows.map((row) => (row._tag === 'Failure' ? row.failure._tag : row.success))).toEqual(['GitUnreadable', 'GitUnreadable']);
  }),
);
