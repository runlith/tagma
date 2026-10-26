import { Data, Context, type Effect } from 'effect';
import type { Pace } from '@runlith/executions/protocol/pace';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';

export type PaceDirection = { readonly from: Pace; readonly to: Pace };

export class TempoRefused extends Data.TaggedError('TempoRefused')<{
  readonly pid: number;
  readonly reason: 'gone' | 'changed' | 'unsupported' | 'os' | 'lost';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export type TempoAsk = { readonly witness: ProcessWitness; readonly initial: Pace; readonly pace: Pace };

export type TempoKept = { readonly _tag: 'Held' } | { readonly _tag: 'Moved' } | TempoRefused;

export class ProcessTempo extends Context.Service<
  ProcessTempo,
  {
    readonly directions: (initial: Pace) => ReadonlyArray<PaceDirection>;
    readonly apply: (processes: ReadonlyArray<TempoAsk>) => Effect.Effect<ReadonlyArray<TempoKept>>;
  }
>()('@runlith/execution-host/ProcessTempo') {}
