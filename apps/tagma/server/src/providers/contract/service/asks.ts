import type { CompactionModels } from '@runlith/agent/thread/compaction/CompactionModels';
import type { EnvironmentEntry } from '@runlith/executions/protocol/execution';
import type { DecisionAnswer, DecisionRequest } from '@runlith/llm/decision';
import type { Usage } from '@runlith/llm/schema/events';
import type { JsonSchema } from '@runlith/llm/schema/ids';
import type { AskCommand, AskKind, AskPath, ProgramOutput } from '@runlith/tagma/adapter/provider';
import { Context, Data, type Effect } from 'effect';

export const ASK_REFUSALS = [
  'ask-not-connected',
  'ask-quota',
  'ask-input-too-large',
  'ask-unreadable-answer',
  'ask-provider-failed',
  'ask-unanswerable',
] as const;
export type AskRefusal = (typeof ASK_REFUSALS)[number];

export class AskRefused extends Data.TaggedError('AskRefused')<{
  readonly refusal: AskRefusal;
  readonly message: string;
  readonly failure?: unknown;
  readonly usage?: Usage;
}> {}

export type AskSelection = {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string | null;
  readonly account: string | null;
};

export type Asker = { readonly provider: string; readonly model: string | null; readonly account: string | null };

export type RoleChoice = { readonly model: string; readonly reasoning: string };

export type FreshAsk = { readonly system: string; readonly input: string; readonly stallMs?: number };

export type ObjectAsk = FreshAsk & { readonly schema: JsonSchema };

export type AskCapacity = { readonly input: number; readonly output: number };

export type Answered<A> = {
  readonly value: A;
  readonly path: AskPath;
  readonly selection: AskSelection;
  readonly usage: Usage | undefined;
};

export class ModelAsks extends Context.Service<
  ModelAsks,
  {
    answers(selection: { readonly provider: string; readonly model: string }, kind: AskKind): boolean;
    choose(kind: AskKind, role: RoleChoice, asker?: Asker): Effect.Effect<AskSelection, AskRefused>;
    defaultFor(kind: AskKind, asker?: Asker): Effect.Effect<AskSelection, AskRefused>;
    capacity(selection: AskSelection, system: string): Effect.Effect<AskCapacity, AskRefused>;
    text(selection: AskSelection, ask: FreshAsk): Effect.Effect<Answered<string>, AskRefused>;
    object(selection: AskSelection, ask: ObjectAsk): Effect.Effect<Answered<unknown>, AskRefused>;
    decide(selection: AskSelection, request: DecisionRequest): Effect.Effect<Answered<DecisionAnswer>, AskRefused>;
    readonly compaction: CompactionModels;
  }
>()('tagma/providers/ModelAsks') {}

export type ProgramRun = {
  readonly provider: string;
  readonly command: AskCommand;
  readonly argv: readonly string[];
  readonly entries: readonly EnvironmentEntry[];
  readonly input: string;
  readonly deadlineMs: number;
};

export class AskPrograms extends Context.Service<
  AskPrograms,
  {
    run(run: ProgramRun): Effect.Effect<ProgramOutput, AskRefused>;
  }
>()('tagma/providers/AskPrograms') {}

export type SavedSelection = { readonly provider: string; readonly model: string; readonly reasoning: string | null };

export class DefaultSelection extends Context.Service<
  DefaultSelection,
  {
    readonly saved: Effect.Effect<SavedSelection | null, AskRefused>;
  }
>()('tagma/providers/DefaultSelection') {}
