import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schedule } from 'effect';
import { Processes } from '../../ProcessReader';
import { keyOf } from '../../hostFixture';
import { background } from '../../posix/testing/tempo';
import { launch, withTerminalHost } from './terminalCase';

const backgrounds = Effect.fnUntraced(function* (leader: number) {
  const processes = yield* Processes;
  const child = (yield* processes.table).find((row) => row.parent === leader && !row.zombie);
  return yield* Effect.forEach(child === undefined ? [leader] : [leader, child.pid], background);
});

it.live('backgrounds a paced terminal and its child under lowest, then returns them to full', () =>
  withTerminalHost({
    body: Effect.fnUntraced(function* ({ hostExecutions, stops, pacing, claim }) {
      expect(yield* pacing.set(claim, 'lowest')).toMatchObject({ _tag: 'Applied', pace: 'lowest', failed: 0 });
      const started = yield* hostExecutions.start(claim, keyOf('terminal-paced'), {
        ...launch('/bin/sh', ['-c', "exec 3<&0; sh -c 'read line <&3' & wait"]),
        paced: true,
      });
      if (started._tag !== 'Started' || started.native.pid === undefined) return yield* Effect.die(new Error(`start: ${started._tag}`));
      const leader = started.native.pid;
      const atLowest = yield* backgrounds(leader).pipe(
        Effect.repeat({ until: (read) => read.length === 2 && read.every(Boolean), schedule: Schedule.spaced('100 millis') }),
      );
      expect(atLowest).toEqual([true, true]);
      expect(yield* pacing.set(claim, 'full')).toEqual({ _tag: 'Applied', pace: 'full', reached: 2, kept: 0, failed: 0 });
      const atFull = yield* backgrounds(leader);
      yield* stops.stop(claim, keyOf('terminal-paced-stop'), started.execution.execution, 'explicit-stop', 'destroy');
      expect(atFull).toEqual([false, false]);
    }),
  }),
);
