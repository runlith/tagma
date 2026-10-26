import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit } from 'effect';
import { agentSpan } from './spans';
it.effect(
  'a parent the schema forbids dies as a defect',
  Effect.fnUntraced(function* () {
    const run = agentSpan({ type: 'run', runId: 'run-1' });
    const spawn = agentSpan({ type: 'spawn', runId: 'run-1', childThreadId: 'thread-2' });
    const exit = yield* Effect.exit(run(spawn(Effect.succeed('ok'))));
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  }),
);
