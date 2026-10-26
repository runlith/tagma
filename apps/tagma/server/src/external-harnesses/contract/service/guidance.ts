import { Context, type Effect } from 'effect';
import type { ReportPlan } from '@runlith/agent/thread/run/lifecycle/RunReports';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import type { ThreadHarness } from '../../../threads/contract/service/engine.js';
import type { touchBriefSchema } from '../../../graph/contract/wire/operations/orientation.js';
import type { Place } from '../../../platform/contract/wire/place.js';

export type RunGuiding = ReturnType<ThreadHarness['Service']['runs']['guidance']>;

export type RunHosting = ReturnType<ThreadHarness['Service']['runs']['hosting']>;

export type Guided = { readonly text: string | null };

export type ClearedGuidance = { readonly plan: ReportPlan; readonly delivered: Effect.Effect<void> };

export class HarnessGuidance extends Context.Service<
  HarnessGuidance,
  {
    prompt(threadId: string, evidence: string, inputs: readonly string[]): Effect.Effect<Guided, HarnessFailure>;
    touch(
      threadId: string,
      evidence: string,
      briefs: readonly (typeof touchBriefSchema.Type)[],
      places: readonly Place[],
    ): Effect.Effect<Guided, HarnessFailure>;
    cleared(threadId: string, evidence: string): Effect.Effect<ClearedGuidance, HarnessFailure>;
    seed(threadId: string, room: number): Effect.Effect<Guided, HarnessFailure>;
  }
>()('tagma/external-harnesses/HarnessGuidance') {}
