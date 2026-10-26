import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Scheduler, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { makeHeads } from './heads.js';

const HEAD = 'a'.repeat(40);

it.effect('two first readings of one checkout at once follow its HEAD once', () =>
  Effect.gen(function* () {
    let follows = 0;
    const heads = yield* makeHeads.pipe(
      Effect.provideContext(
        Context.make(
          Git,
          Git.of({ run: () => Effect.succeed({ status: 0, stdout: `${HEAD}\n`, stderr: '', overflow: false, messageOverflow: false }) }),
        ).pipe(
          Context.add(
            CheckoutRows,
            CheckoutRows.of({
              read: () => Effect.die('the checkout row is not read'),
              refresh: () => Effect.die('the checkout row is not refreshed'),
              subscribe: () => Stream.die('the checkout row is not followed'),
              follow: () => Effect.die('the checkout row is not followed'),
              mark: () => Effect.die('nothing is marked'),
              onMark: () => () => undefined,
              headMoved: () => {
                follows += 1;
                return Stream.never;
              },
              checkoutsMoved: () => Stream.never,
            }),
          ),
        ),
      ),
    );
    const place = { checkout: 'repo', path: '', projectId: 1, root: '/repo' };
    const answers = yield* Effect.all([heads.of(1, place), heads.of(1, place)], { concurrency: 2 }).pipe(
      Effect.provideService(Scheduler.MaxOpsBeforeYield, 3),
    );
    expect(answers).toEqual([HEAD, HEAD]);
    expect(follows).toBe(1);
  }),
);
