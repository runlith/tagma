import { Context, type Effect, type Stream } from 'effect';
import type { PaceReport } from '@runlith/executions/protocol/pace';
import type { PaceLevel, PaceState } from '../wire/power.js';

export class HostPace extends Context.Service<
  HostPace,
  {
    apply(pace: PaceLevel): Effect.Effect<PaceReport, { readonly reason: string }>;
  }
>()('tagma/power/HostPace') {}

export class AgentPace extends Context.Service<
  AgentPace,
  {
    state(): PaceState;
    readonly changes: Stream.Stream<PaceState>;
  }
>()('tagma/power/AgentPace') {}
