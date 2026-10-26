import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import { Usage } from '@runlith/llm/schema/events';
import { lifecycleWorld } from './lifecycleWorld';
import type { ThreadStorageFactory } from './storagePort';
import { opened, report } from './transport';

export function describeLateSpend<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: spend an adapter reports after its run`, () => {
    test(
      'spend reported after the core ended the run lands on it once, and neither a repeated end nor a request repeated after the end counts twice',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const reports = world.reports.of('native');
        const request = Usage.from({ inputTokens: 900, outputTokens: 50, totalTokens: 950 });
        const rest = Usage.from({ inputTokens: 5, outputTokens: 2, totalTokens: 7 });
        const cost = { amount: 0.25, currency: 'USD', basis: 'list' };
        const late = yield* opened(world);
        yield* world.lifecycle.finish(late, { kind: 'completed' });
        expect((yield* report(world, reports.measured(late, { usage: request, attempt: 0 }, 'measured:m1'))).status).toBe('applied');
        expect((yield* report(world, reports.measured(late, { usage: request, attempt: 0 }, 'measured:m1'))).status).toBe('replayed');
        yield* report(world, reports.ended(late, { kind: 'aborted', stoppedBy: 'reader' }, { rest, cost }));
        yield* report(world, reports.ended(late, { kind: 'aborted', stoppedBy: 'reader' }, { rest, cost }));
        expect(yield* world.runs.runById(late.id)).toMatchObject({
          status: 'completed',
          usage: { inputTokens: 905, outputTokens: 52, totalTokens: 957 },
          cost,
        });
        const ending = yield* opened(world);
        yield* report(world, reports.measured(ending, { usage: request, attempt: 0 }, 'measured:m2'));
        yield* report(world, reports.ended(ending, { kind: 'completed' }, { rest, cost }));
        expect((yield* report(world, reports.measured(ending, { usage: request, attempt: 0 }, 'measured:m2'))).status).toBe('replayed');
        yield* report(world, reports.ended(ending, { kind: 'completed' }, { rest, cost }));
        expect((yield* world.runs.runById(ending.id))?.usage).toMatchObject({ inputTokens: 905, outputTokens: 52, totalTokens: 957 });
      }),
    );
  });
}
