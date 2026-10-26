import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Result } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { ConsoleKeyRollback, DowngradeSteps } from '../contract/service/steps.js';
import { prepareDowngrade } from './downgrade.js';

const operator: Caller = { actor: { kind: 'operator' }, files: null };

type Seen = { acts: string[] };

const queue = (seen: Seen, drained: { readonly waiting: number; readonly unread: number }): DowngradeSteps['Service'] => ({
  close: () => Effect.sync(() => void seen.acts.push('close')),
  reopen: () => Effect.sync(() => void seen.acts.push('reopen')),
  drained: () => Effect.sync(() => (seen.acts.push('drained'), drained)),
});

const rollback = (seen: Seen): ConsoleKeyRollback['Service'] => ({
  copyToSnapshot: (snapshot) => Effect.sync(() => (seen.acts.push(`copy ${snapshot}`), [])),
});

const prepared = <R>(bound: Context.Context<R>, snapshot?: string) =>
  Effect.result(prepareDowngrade.body.execute(snapshot === undefined ? {} : { snapshot }, undefined, operator)).pipe(
    Effect.provideContext(bound),
  );

const states = (answer: Effect.Success<ReturnType<typeof prepared>>) =>
  Result.isSuccess(answer) && answer.success.status === 'ready' ? answer.success.steps.map((step) => `${step.step}:${step.state}`) : answer;

it.effect('a queue holding a waiting or unread line refuses before the rollback writes', () =>
  Effect.gen(function* () {
    const seen: Seen = { acts: [] };
    const answer = yield* prepared(
      Context.make(DowngradeSteps, queue(seen, { waiting: 0, unread: 1 })).pipe(Context.add(ConsoleKeyRollback, rollback(seen))),
      '/copy.sqlite',
    );
    expect(Result.isFailure(answer) && answer.failure.code).toBe('queue-undrained');
    expect(seen.acts).toEqual(['close', 'drained', 'reopen']);
  }),
);

it.effect('the rollback writes into the named copy only after the preflight passes', () =>
  Effect.gen(function* () {
    const seen: Seen = { acts: [] };
    const answer = yield* prepared(
      Context.make(DowngradeSteps, queue(seen, { waiting: 0, unread: 0 })).pipe(Context.add(ConsoleKeyRollback, rollback(seen))),
      '/copy.sqlite',
    );
    expect(states(answer)).toEqual(['downgrade-preflight:passed', 'console-key-rollback:written']);
    expect(seen.acts).toEqual(['close', 'drained', 'copy /copy.sqlite']);
  }),
);

it.effect('an unbound preflight is named and keeps the rollback from writing', () =>
  Effect.gen(function* () {
    const seen: Seen = { acts: [] };
    const answer = yield* prepared(Context.make(ConsoleKeyRollback, rollback(seen)), '/copy.sqlite');
    expect(states(answer)).toEqual(['downgrade-preflight:unbound', 'console-key-rollback:skipped']);
    expect(seen.acts).toEqual([]);
  }),
);

it.effect('with neither step bound both are named unbound', () =>
  Effect.gen(function* () {
    expect(states(yield* prepared(Context.empty()))).toEqual(['downgrade-preflight:unbound', 'console-key-rollback:unbound']);
  }),
);
