import { Context, type Effect } from 'effect';
import type { HarnessAdoptInput, HarnessAdopted } from '../wire/adoption.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';

export class HarnessAdoption extends Context.Service<
  HarnessAdoption,
  {
    adopt(ask: HarnessAdoptInput, projectId: number | null): Effect.Effect<HarnessAdopted, HarnessFailure>;
    adopters(projectId: number, executions: readonly string[]): Effect.Effect<ReadonlyMap<string, string>>;
  }
>()('tagma/external-harnesses/HarnessAdoption') {}
