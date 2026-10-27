import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import type { InputCause } from '@runlith/executions/protocol/input';
import type { LaneInput } from '@runlith/executions/protocol/lane';
import { byteOffset } from '@runlith/executions/protocol/record';
import { makeLaneInputs } from './LaneInputs';

const window = BindingId.make('binding-window');
const other = BindingId.make('binding-other');

const admitted = (binding: BindingId, sequence: number, cause: InputCause): LaneInput => ({
  binding,
  principal: Principal.make('operator'),
  receipt: {
    execution: { installation: InstallationId.make('installation-1'), execution: ExecutionId.make('execution-1'), incarnation: 0 },
    sequence,
    cause,
    bytes: 1,
    acceptedThrough: byteOffset(BigInt(sequence + 1)),
  },
});

describe('the admitted input of terminal lanes', () => {
  it.effect('keeps the latest event of each cause for a subscriber that fell behind, so a raw act does not hide typing', () =>
    Effect.gen(function* () {
      const lanes = makeLaneInputs();
      yield* lanes.track(window);
      yield* lanes.track(other);
      const watch = yield* lanes.watch;
      for (const [sequence, cause] of [
        [0, 'typed'],
        [1, 'typed'],
        [2, 'raw'],
      ] as const)
        yield* lanes.publish(admitted(window, sequence, cause));
      yield* lanes.publish(admitted(other, 0, 'typed'));
      const heard: LaneInput[] = [];
      for (let input = yield* watch.next; input.binding === window; input = yield* watch.next) heard.push(input);
      expect(heard).toEqual([admitted(window, 1, 'typed'), admitted(window, 2, 'raw')]);
    }),
  );
});
