import { Context, type Stream } from 'effect';
import type { AwakeState } from '../wire/power.js';

export class AwakePolicy extends Context.Service<
  AwakePolicy,
  {
    state(): AwakeState;
    readonly changes: Stream.Stream<AwakeState>;
    working(runs: number): void;
  }
>()('tagma/power/AwakePolicy') {}
