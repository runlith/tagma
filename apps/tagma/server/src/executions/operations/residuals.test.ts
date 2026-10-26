import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Exit, Ref } from 'effect';
import { WireUnavailable } from '@runlith/executions/Executions';
import type { ResidualEnding } from '@runlith/executions/protocol/stop';
import { HostManagement } from '../contract/service/host.js';
import { RESIDUAL_PAIRS } from './residuals.js';

const origin = { installation: 'installation-1', execution: 'execution-1', incarnation: 1 } as never;

const hostOf = (endResidual: (pid: number) => Effect.Effect<ResidualEnding, WireUnavailable>) =>
  ({
    standing: Effect.never,
    report: Effect.never,
    connection: { port: { endResidual: (_: unknown, pid: number) => endResidual(pid) } },
  }) as never;

const run = <A, E>(work: Effect.Effect<A, E, unknown>) => work as Effect.Effect<A, E>;

const ended = (pid: number): ResidualEnding => ({ _tag: 'Ended', origin, pid, steps: ['terminate'] });

describe('ending residual processes', () => {
  it.effect('one residual is answered with exactly what the host proved, refusals included', () =>
    Effect.gen(function* () {
      const refused: ResidualEnding = {
        _tag: 'Refused',
        origin,
        pid: 7,
        reason: 'identity-changed',
        detail: 'the pid holds another process',
        steps: [],
      };
      const answer = yield* run(
        RESIDUAL_PAIRS.end_residual.body.execute({ origin, pid: 7 }, undefined, {} as never).pipe(
          Effect.provideService(
            HostManagement,
            hostOf(() => Effect.succeed(refused)),
          ),
        ),
      );
      expect(answer).toMatchObject({ status: 'ok', outcome: refused });
    }),
  );

  it.effect('a batch answers one outcome each in the order asked, keeps going past an unreachable host, and holds three at a time', () =>
    Effect.gen(function* () {
      const pids = [1, 2, 3, 4, 5, 6, 7, 8];
      const live = yield* Ref.make(0);
      const most = yield* Ref.make(0);
      const port = hostOf(
        Effect.fnUntraced(function* (pid) {
          const now = yield* Ref.updateAndGet(live, (count) => count + 1);
          yield* Ref.update(most, (held) => Math.max(held, now));
          for (let turn = 0; turn < 5; turn += 1) yield* Effect.yieldNow;
          yield* Ref.update(live, (count) => count - 1);
          return pid === 4
            ? yield* Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: 'the socket is gone', sent: false }))
            : ended(pid);
        }),
      );
      const outcome = yield* run(
        RESIDUAL_PAIRS.end_residuals.body
          .execute({ residuals: pids.map((pid) => ({ origin, pid })) }, undefined, {} as never)
          .pipe(Effect.provideService(HostManagement, port)),
      );
      if (outcome.status !== 'ok') return yield* Effect.die('the batch was refused');
      expect(outcome.outcomes.map((each) => [each._tag, each.pid])).toEqual(pids.map((pid) => [pid === 4 ? 'Unreached' : 'Ended', pid]));
      expect(outcome.outcomes[3]).toMatchObject({ failure: 'WireUnavailable', detail: 'the socket is gone' });
      expect(yield* Ref.get(most)).toBe(3);
    }),
  );

  it.effect('a batch larger than one load frame can name is refused before anything is asked of the host', () =>
    Effect.gen(function* () {
      let asked = 0;
      const exit = yield* run(
        Effect.exit(
          RESIDUAL_PAIRS.end_residuals.body
            .execute({ residuals: Array.from({ length: 100_000 }, (_, index) => ({ origin, pid: index + 1 })) }, undefined, {} as never)
            .pipe(
              Effect.provideService(
                HostManagement,
                hostOf((pid) =>
                  Effect.sync(() => {
                    asked += 1;
                    return ended(pid);
                  }),
                ),
              ),
            ),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(asked).toBe(0);
    }),
  );
});
