import { Context, Data, type Effect } from 'effect';
import type { block, edge, event, source } from '../../store/tables.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { FloorRefusal, GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { GraphEventOp } from '../wire/journal.js';
import type { ActState } from './transaction.js';
import type { NodeActions } from '../wire/tags/actions.js';
import type { Ref } from '../wire/rows.js';

export type ActEntry = typeof event.$inferSelect;

export type TreeLanding = Effect.Effect<void>;

export type BlockRow = typeof block.$inferSelect;
export type EdgeRow = typeof edge.$inferSelect;
export type SourceRow = typeof source.$inferSelect;

export type BlockMeasurement = {
  superseded: boolean;
  blocked: boolean;
  building: boolean;
  answered: boolean;
};

export type MeasuredBlock<TRow, TFact extends keyof BlockMeasurement = keyof BlockMeasurement> = TRow &
  Pick<BlockMeasurement, TFact> & { readonly actions: NodeActions; readonly parentUuid: string | null };

export type BlockRecord<TRow extends BlockRow = BlockRow> = MeasuredBlock<TRow>;

export const MEASURED_FACTS = ['superseded', 'blocked', 'building', 'answered'] as const;

export type Answer =
  | { readonly kind: 'block'; readonly id: number }
  | { readonly kind: 'commit'; readonly sha: string }
  | { readonly kind: 'checked'; readonly finding: string; readonly head: string | null };

export type AnswerState = 'live' | 'withdrawn' | 'never';

export type BlockWrite = BlockRecord & { refsIn: string[] };

export type RecordedBlock = { readonly id: number; readonly projectId: number };

export type TreeWrite = (entries: readonly ActEntry[]) => Effect.Effect<TreeLanding, GateRefusal<FloorRefusal> | StoreFailure>;

export type TreeProjection = {
  readonly write: TreeWrite;
  readonly undo: Effect.Effect<void, GateRefusal<FloorRefusal>>;
};

export const TreeGuard = Context.Reference<
  | {
      guard<A, E, R>(act: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
      readonly prepare: Effect.Effect<TreeProjection>;
      readonly writes: WriteSet;
    }
  | undefined
>('tagma/graph/TreeGuard', {
  defaultValue: () => undefined,
});

export const CommitEffects = Context.Reference<ReadonlyArray<Effect.Effect<void>>>('tagma/graph/CommitEffects', {
  defaultValue: () => [],
});

export const Unborn = Context.Reference<(name: string) => boolean>('tagma/graph/Unborn', {
  defaultValue: () => () => false,
});

export class Act extends Context.Service<
  Act,
  {
    unit<A, E, R>(
      set: WriteSet,
      body: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | StoreFailure | GateRefusal<FloorRefusal>, Exclude<R, ActState>>;
    record(
      op: GraphEventOp,
      subject: number | RecordedBlock | null,
      payload: Record<string, unknown>,
      at?: Date,
      writer?: number,
    ): Effect.Effect<void, StoreFailure, ActState>;
  }
>()('tagma/graph/Act') {}

export class BlockNames extends Context.Service<
  BlockNames,
  {
    candidatesOfName(
      name: string,
    ): Effect.Effect<readonly { readonly id: number; readonly uuid: string }[], StoreFailure | GateRefusal<'bad-name'>>;
    idOfName(name: string): Effect.Effect<number, StoreFailure | GateRefusal<'bad-name' | 'not-found' | 'ambiguous-name'>>;
    idsOfNames(names: readonly string[]): Effect.Effect<Map<string, number>, StoreFailure>;
    nameOf(id: number): Effect.Effect<string, StoreFailure>;
    namesOf(ids: readonly number[]): Effect.Effect<ReadonlyMap<number, string>, StoreFailure>;
    identitiesOf(ids: readonly number[]): Effect.Effect<ReadonlyMap<number, string>, StoreFailure>;
    uuidOf(id: number): Effect.Effect<string | null, StoreFailure>;
  }
>()('tagma/graph/BlockNames') {}

export class BlockAnswers extends Context.Service<
  BlockAnswers,
  {
    answerOf(id: number): Effect.Effect<Answer | null, StoreFailure>;
    answersOf(ids: readonly number[]): Effect.Effect<ReadonlyMap<number, Answer>, StoreFailure>;
    answerStateOf(id: number, answer: Answer): Effect.Effect<AnswerState, StoreFailure>;
    answeredCommits(id: number): Effect.Effect<readonly string[], StoreFailure>;
  }
>()('tagma/graph/BlockAnswers') {}

export type DerivedFact = 'refs' | 'search' | 'tags';

export class SearchUncounted extends Data.TaggedError('SearchUncounted')<{
  readonly message: string;
}> {}

export class BlockProjection extends Context.Service<
  BlockProjection,
  {
    completeDerived(scope?: 'all' | 'types'): Effect.Effect<void, StoreFailure | SearchUncounted | GateRefusal<FloorRefusal>>;
    derive(blockIds: readonly number[], facts?: readonly DerivedFact[]): Effect.Effect<void, StoreFailure | SearchUncounted, ActState>;
    discard(blockIds?: readonly number[]): Effect.Effect<void, StoreFailure, ActState>;
    syncSearch(blockId: number): Effect.Effect<void, StoreFailure, ActState>;
    syncTags(blockId: number): Effect.Effect<void, StoreFailure, ActState>;
    syncBorn(row: BlockRow, search: boolean): Effect.Effect<void, StoreFailure, ActState>;
    forgetVocabulary(blockIds: readonly number[]): Effect.Effect<void, StoreFailure, ActState>;
  }
>()('tagma/graph/BlockProjection') {}

export class BlockReferences extends Context.Service<
  BlockReferences,
  {
    refsIn(id: number): Effect.Effect<string[], StoreFailure>;
    syncRefs(blockId: number, body: string, born?: { readonly projectId: number }): Effect.Effect<void, StoreFailure, ActState>;
    refsOf(projectId: number, within?: ReadonlySet<number>): Effect.Effect<Ref[], StoreFailure>;
  }
>()('tagma/graph/BlockReferences') {}
