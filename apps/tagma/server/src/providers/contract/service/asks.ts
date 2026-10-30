import type { CompactionModels } from '@runlith/agent/thread/compaction/CompactionModels';
import type { EnvironmentEntry } from '@runlith/executions/protocol/execution';
import type { DecisionAnswer, DecisionRequest } from '@runlith/llm/decision';
import type { Usage } from '@runlith/llm/schema/events';
import type { LLMError } from '@runlith/llm/schema/errors';
import type { ModelIdentity } from '@runlith/llm/schema/options';
import { isContextOverflowFailure } from '@runlith/llm/provider-error';
import type { AskKind } from '@runlith/llm/models/description';
import type { AskProgram, ProgramAsk, ProgramOutput } from '@runlith/tagma/adapter/provider';
import { Context, Data, type Effect } from 'effect';
import { GateRefusal, type Unblock } from '../../../platform/contract/wire/refusal.js';
import type { AskChoice } from '../../../platform/contract/wire/setting.js';
import type { AskPath, AskRefusal } from '../wire/asks.js';

export class AskRefused extends Data.TaggedError('AskRefused')<{
  readonly refusal: AskRefusal;
  readonly message: string;
  readonly failure?: unknown;
  readonly usage?: Usage;
}> {}

export const askGate = (refused: AskRefused, unblock: Unblock): GateRefusal<AskRefusal> =>
  new GateRefusal(refused.refusal, refused.message, unblock);

export const askFailure = (failure: LLMError): AskRefused => {
  const refusal: AskRefusal = isContextOverflowFailure(failure)
    ? 'ask-input-too-large'
    : failure.reason._tag === 'Authentication' || failure.reason._tag === 'NotInstalled' || failure.reason._tag === 'AdapterFailed'
      ? 'ask-not-connected'
      : failure.reason._tag === 'QuotaExceeded'
        ? 'ask-quota'
        : failure.reason._tag === 'InvalidProviderOutput'
          ? 'ask-unreadable-answer'
          : 'ask-provider-failed';
  return new AskRefused({ refusal, message: failure.message, failure });
};

export type NamedModel = { readonly provider: string; readonly model: string };

export const namedModel = (key: string): NamedModel | null => {
  if (key === '') return null;
  const split = key.indexOf(':');
  return split === -1 ? { provider: key, model: '' } : { provider: key.slice(0, split), model: key.slice(split + 1) };
};

export type Asker = { readonly provider: string; readonly model: string | null; readonly account: string | null };

export type ModelSelection = Asker & { readonly reasoning: string | null };

export type ModelResolution = { readonly origin: ModelIdentity | undefined; readonly reasoning: string | null };

export type AskSelection = ModelSelection & NamedModel;

export type FreshAsk = { readonly system: string; readonly input: string; readonly stallMs?: number; readonly runId?: string };

export type AskCapacity = { readonly input: number; readonly output: number };

export type Answered<A> = {
  readonly value: A;
  readonly path: AskPath;
  readonly selection: AskSelection;
  readonly usage: Usage | undefined;
  readonly account: string | undefined;
};

export class ModelAsks extends Context.Service<
  ModelAsks,
  {
    resolve(selection: ModelSelection): ModelResolution;
    choose(kind: AskKind, role: AskChoice | null, asker?: Asker): Effect.Effect<AskSelection, AskRefused>;
    capacity(selection: AskSelection, system: string): Effect.Effect<AskCapacity, AskRefused>;
    text(selection: AskSelection, ask: FreshAsk): Effect.Effect<Answered<string>, AskRefused>;
    decide(selection: AskSelection, request: DecisionRequest): Effect.Effect<Answered<DecisionAnswer>, AskRefused>;
  }
>()('tagma/providers/ModelAsks') {}

export class CompactionAsks extends Context.Service<CompactionAsks, CompactionModels>()('tagma/providers/CompactionAsks') {}

export type ProgramRun = {
  readonly program: AskProgram;
  readonly ask: ProgramAsk;
  readonly entries: readonly EnvironmentEntry[];
  readonly input: string;
  readonly deadlineMs: number;
};

export class ProgramFailed extends Data.TaggedError('ProgramFailed')<{ readonly message: string }> {}

export class AskPrograms extends Context.Service<
  AskPrograms,
  {
    run(run: ProgramRun): Effect.Effect<ProgramOutput, ProgramFailed>;
  }
>()('tagma/providers/AskPrograms') {}

export type SavedSelection = { readonly provider: string; readonly model: string };

export class DefaultSelection extends Context.Service<
  DefaultSelection,
  {
    readonly saved: Effect.Effect<SavedSelection | null>;
  }
>()('tagma/providers/DefaultSelection') {}
