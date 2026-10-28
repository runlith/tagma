import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { SessionRow, WriterRef } from '../../../platform/contract/service/writers.js';
import type { HolderStanding } from '../wire/holders.js';
import type { SessionRef } from '../../../platform/contract/wire/session.js';
import type { HeldTask } from './serving.js';
import type { FloorRefusal, GateRefusal, GitRefusal, OpenRefusal, ReferenceRefusal } from '../../../platform/contract/wire/refusal.js';
import type { BlockRecord, BlockRow, BlockWrite, SourceRow } from './acts.js';
import type {
  AmendmentPayloadRefusal,
  BlockCreateRefusal,
  BlockEditRefusal,
  EdgeRefusal,
  FieldWriteRefusal,
  RetagRefusal,
  TagWriteRefusal,
} from './blocks.js';
import type { BlockPosition, SelectionRefusal } from './reads.js';
import type { PageSlice } from '@runlith/paging';
import type { PlacementRefusal } from './sources.js';
import type { TransitionRefusal } from '../wire/lifecycle.js';
import type { SourceInput } from '../wire/sources.js';
import type { AmendmentOp, BatchInput } from '../wire/batch.js';
import type { ActState } from './transaction.js';
import type { CreationDefaultRefusal } from '../wire/tags/profile.js';
import type { HeldWork } from '../wire/operations/shared.js';
import type { ThreadAct } from '../wire/threadWork.js';

export type BlockEnding = {
  status: string;
  writer: WriterRef;
  reason: string | null;
  at: Date;
  commit?: string | null;
  unreadable?: string;
};

export type BlockEnd = BlockRecord;

export type IdleWork = { readonly id: number; readonly holder: SessionRow; readonly standing: HolderStanding };

export type Holdings = { readonly held: readonly HeldTask[]; readonly filed: readonly HeldTask[] };

export type WorkBlock = { readonly name: string; readonly title: string; readonly tags: readonly string[]; readonly status: string | null };

export type HeldBlock = WorkBlock & {
  readonly spec: { readonly name: string; readonly title: string; readonly tags: readonly string[] } | null;
};

export type ActedBlock = WorkBlock & {
  readonly acts: readonly ThreadAct[];
  readonly last: ThreadAct;
  readonly at: number;
  readonly lastId: number;
  readonly commit: string | null;
  readonly commitUnread: string | null;
  readonly trashed: boolean;
};

export type ClaimRefusal =
  | FloorRefusal
  | 'not-found'
  | 'deleted'
  | 'no-holder'
  | 'claimed-elsewhere'
  | 'superseded'
  | 'no-status'
  | 'illegal-status'
  | 'illegal-transition';

export type ActedAfter = { readonly at: number; readonly lastId: number };

export type SessionWork = { readonly held: readonly HeldBlock[]; readonly did: readonly ActedBlock[]; readonly total: number };

export class Tasks extends Context.Service<
  Tasks,
  {
    heldElsewhere(row: BlockRow): Effect.Effect<HeldWork | null, StoreFailure>;
    idle(input: { readonly projectId: number; readonly scopeId?: number | undefined }): Effect.Effect<readonly IdleWork[], StoreFailure>;
    holdings(input: { readonly projectId: number; readonly from: SessionRef }): Effect.Effect<Holdings, StoreFailure>;
    workOf(input: {
      readonly projectId: number;
      readonly from: SessionRef;
      readonly after: ActedAfter | undefined;
      readonly rows: number;
    }): Effect.Effect<SessionWork, StoreFailure>;
    handOver(input: {
      readonly projectId: number;
      readonly from: SessionRef;
      readonly to: SessionRef | null;
    }): Effect.Effect<readonly HeldTask[], StoreFailure | GateRefusal<FloorRefusal>>;
    claimable(input: { id: number }): Effect.Effect<void, StoreFailure | GateRefusal<ClaimRefusal>>;
    claim(input: {
      id: number;
      as?: SessionRef | undefined;
      over?: number | null | undefined;
    }): Effect.Effect<BlockRecord, StoreFailure | GateRefusal<ClaimRefusal>>;
    release(input: {
      id: number;
    }): Effect.Effect<
      BlockRecord,
      | StoreFailure
      | GateRefusal<
          FloorRefusal | 'not-found' | 'deleted' | 'no-holder' | 'not-held' | 'no-status' | 'illegal-status' | 'illegal-transition'
        >
    >;
    finish(input: {
      id: number;
      commit?: string;
      operator?: boolean;
    }): Effect.Effect<
      BlockEnd,
      | StoreFailure
      | GateRefusal<
          | FloorRefusal
          | 'not-found'
          | 'deleted'
          | 'superseded'
          | 'not-closable'
          | 'open-children'
          | 'status-operation'
          | 'no-status'
          | 'illegal-status'
          | 'illegal-transition'
        >
    >;
    close(input: {
      id: number;
      reason?: string;
      operator?: boolean;
    }): Effect.Effect<
      BlockEnd,
      | StoreFailure
      | GateRefusal<
          | FloorRefusal
          | 'not-found'
          | 'deleted'
          | 'superseded'
          | 'not-closable'
          | 'open-children'
          | 'status-operation'
          | 'no-status'
          | 'illegal-status'
          | 'illegal-transition'
        >
    >;
    endings(rows: readonly BlockRow[]): Effect.Effect<ReadonlyMap<number, BlockEnding>, StoreFailure>;
    worklessSpecs(where: WorklessSpecs): Effect.Effect<readonly WorklessSpec[], StoreFailure>;
    specsLeftBy(ended: readonly BlockEnd[]): Effect.Effect<readonly WorklessSpec[], StoreFailure>;
  }
>()('tagma/graph/Tasks') {}

export type WorklessSpec = { readonly uuid: string; readonly title: string; readonly projectId?: number };

export type WorklessSpecs = { readonly projectId: number } & (
  | { readonly above: readonly number[] }
  | { readonly scopeId?: number | undefined }
);

export type ProposalVerdictRow = {
  status: string;
  writer: WriterRef;
  reason: string | null;
  by: string[];
  at: Date;
  unreadable?: string;
};

export type ProposalListRow = BlockRecord & { sources: SourceRow[] };

export type ReviewConflict = {
  a: string;
  b: string;
  region: { kind: 'text'; blockName: string } | { kind: 'code'; anchor: string };
};

export type ConflictFilter = {
  readonly projectId: number;
  readonly scopeId?: number;
  readonly names?: readonly string[];
};

export type ReviewConflicts = {
  readonly found: readonly ReviewConflict[];
  readonly total: number;
  readonly unread: readonly { readonly name: string; readonly reason: string }[];
};

export class Review extends Context.Service<
  Review,
  {
    propose(input: {
      projectId: number;
      amendsId: number;
      title: string;
      body?: string;
      ops: readonly AmendmentOp[];
      sources?: readonly SourceInput[];
      parentId?: number;
    }): Effect.Effect<
      BlockWrite,
      | StoreFailure
      | GateRefusal<
          | BlockCreateRefusal
          | 'cross-project'
          | 'amends-an-amendment'
          | 'amendment-shape'
          | CreationDefaultRefusal
          | 'creation-contract'
          | 'amendment-empty'
          | 'amendment-op'
          | 'amendment-ref'
          | 'amendment-outside'
          | 'leaf'
          | 'not-found'
          | 'bad-name'
          | 'ambiguous-name'
          | 'body-capped'
          | 'body-address'
        >
    >;
    revise(input: {
      id: number;
      ops: readonly AmendmentOp[];
    }): Effect.Effect<
      BlockRecord,
      | StoreFailure
      | GateRefusal<
          | FloorRefusal
          | 'not-found'
          | 'deleted'
          | 'not-an-amendment'
          | 'verdict-standing'
          | CreationDefaultRefusal
          | 'creation-contract'
          | 'amendment-empty'
          | 'amendment-op'
          | 'amendment-ref'
          | 'amendment-outside'
          | 'leaf'
          | 'bad-name'
          | 'ambiguous-name'
          | 'body-capped'
          | 'body-address'
        >
    >;
    accept(input: {
      id: number;
      reason?: string;
      enclosing?: ReadonlyMap<string, number>;
    }): Effect.Effect<
      BlockRecord,
      | StoreFailure
      | GateRefusal<
          | FloorRefusal
          | 'not-found'
          | 'deleted'
          | 'not-an-amendment'
          | 'no-status'
          | 'illegal-status'
          | 'illegal-transition'
          | CreationDefaultRefusal
          | 'creation-contract'
          | 'amendment-empty'
          | 'amendment-op'
          | 'amendment-ref'
          | 'amendment-outside'
          | 'leaf'
          | 'bad-name'
          | 'ambiguous-name'
          | AcceptedRefusal
          | 'anchor-not-found'
          | 'field-invalid'
        >
    >;
    reject(input: {
      id: number;
      reason?: string;
    }): Effect.Effect<
      BlockRecord,
      | StoreFailure
      | GateRefusal<
          | FloorRefusal
          | 'not-found'
          | 'deleted'
          | 'not-an-amendment'
          | 'no-status'
          | 'illegal-status'
          | 'illegal-transition'
          | 'reason-required'
        >
    >;
    uphold(input: {
      id: number;
      reason?: string;
      by: readonly number[];
    }): Effect.Effect<
      BlockRecord,
      | StoreFailure
      | GateRefusal<
          | FloorRefusal
          | 'not-found'
          | 'deleted'
          | 'not-an-amendment'
          | 'no-status'
          | 'illegal-status'
          | 'illegal-transition'
          | 'reason-required'
          | 'self-answer'
          | 'cross-project'
        >
    >;
    verdicts(rows: readonly BlockRow[]): Effect.Effect<ReadonlyMap<number, ProposalVerdictRow>, StoreFailure>;
    obstacles(proposalId: number): Effect.Effect<string[], StoreFailure>;
    conflicts(filter: ConflictFilter): Effect.Effect<ReviewConflicts, StoreFailure>;
    proposals(filter: ProposalFilter): Effect.Effect<ProposalListRow[], StoreFailure | GateRefusal<SelectionRefusal>>;
    proposalsPage(
      filter: ProposalFilter,
      after: BlockPosition | undefined,
      rows: number,
    ): Effect.Effect<PageSlice<ProposalListRow, number>, StoreFailure | GateRefusal<SelectionRefusal>>;
  }
>()('tagma/graph/Review') {}

export type ProposalFilter = {
  readonly projectId?: number | undefined;
  readonly scopeId?: number | undefined;
  readonly decided?: boolean | undefined;
};

export type AnswerInput = { readonly id: number } & (
  | { readonly byId: number }
  | { readonly commit: string }
  | { readonly checked: string }
);

export type UnanswerInput = { readonly id: number } & (
  | { readonly byId: number }
  | { readonly commit: string }
  | { readonly checked: true }
);

export class Reflections extends Context.Service<
  Reflections,
  {
    answer(
      input: AnswerInput,
    ): Effect.Effect<
      BlockRecord,
      | StoreFailure
      | GateRefusal<
          | FloorRefusal
          | GitRefusal
          | 'not-found'
          | 'deleted'
          | 'not-a-reflection'
          | 'not-finished'
          | 'already-answered'
          | 'self-answer'
          | 'cross-project'
          | 'commit-unknown'
          | 'commit-unlanded'
        >
    >;
    unanswer(
      input: UnanswerInput,
    ): Effect.Effect<
      BlockRecord,
      StoreFailure | GateRefusal<FloorRefusal | 'not-found' | 'deleted' | 'not-a-reflection' | 'not-an-answer'>
    >;
    standing(
      home: BlockRow,
      after: BlockPosition | undefined,
      rows: number,
    ): Effect.Effect<PageSlice<ReflectionEntry, number>, StoreFailure>;
    groups(home: BlockRow, ids: readonly number[]): Effect.Effect<readonly ReflectionEntry[], StoreFailure>;
  }
>()('tagma/graph/Reflections') {}

export type ReflectionEntry = BlockRecord & { readonly sightings: number };

export class Supersession extends Context.Service<
  Supersession,
  {
    supersede(input: {
      oldId: number;
      withId: number;
    }): Effect.Effect<
      BlockWrite,
      | StoreFailure
      | GateRefusal<
          | FloorRefusal
          | 'not-found'
          | 'deleted'
          | 'self-supersede'
          | 'cross-project'
          | 'already-superseded'
          | 'successor-superseded'
          | 'field-invalid'
          | 'operation-only'
        >
    >;
    unsupersede(input: {
      id: number;
    }): Effect.Effect<BlockWrite, StoreFailure | GateRefusal<FloorRefusal | 'not-found' | 'deleted' | 'not-superseded'>>;
    isSuperseded(id: number): Effect.Effect<boolean, StoreFailure>;
    supersedesReaches(from: number, to: number): Effect.Effect<boolean, StoreFailure>;
    successorOf(id: number): Effect.Effect<number | null, StoreFailure>;
  }
>()('tagma/graph/Supersession') {}

export class Batch extends Context.Service<
  Batch,
  {
    apply(input: BatchInput, projectId: number, operator?: boolean): Effect.Effect<BatchAnswer, StoreFailure | GateRefusal>;
    held(input: BatchInput): Effect.Effect<readonly HeldWork[], StoreFailure | GateRefusal<'batch-source'>>;
  }
>()('tagma/graph/Batch') {}

export type OpOutcome = BlockWrite | BlockRecord | SourceRow | { ok: true };

export type BatchAnswer = {
  ops: OpOutcome[];
  ids: Record<string, string>;
  bodyFiles?: Record<number, string>;
  specs?: readonly WorklessSpec[];
};

export type Handles = {
  readonly declared: Map<string, number>;
  readonly outer?: ReadonlyMap<string, number>;
  readonly minted: ReadonlyMap<string, string>;
  readonly awaiting: Set<number>;
  readonly resolve: (name: string) => Effect.Effect<number, GateRefusal<ReferenceRefusal | 'not-found'> | StoreFailure>;
};

export type DocumentRefRefusal = ReferenceRefusal | 'not-found' | 'batch-ref';

export type DocumentRefusal = FloorRefusal | 'batch-shape' | 'batch-ref' | 'body-capped' | 'field-target' | 'not-found';

export type AmendmentOpRefusal =
  | DocumentRefRefusal
  | BlockCreateRefusal
  | BlockEditRefusal
  | RetagRefusal
  | EdgeRefusal
  | FloorRefusal
  | 'no-edge'
  | 'project-root'
  | 'catalog-member'
  | 'deleted'
  | 'verdict-standing';

export type AcceptedOpRefusal =
  | GitRefusal
  | 'tree-not-measured'
  | CreationDefaultRefusal
  | 'creation-contract'
  | 'no-holder'
  | 'claimed-elsewhere'
  | DocumentRefRefusal
  | FloorRefusal
  | TagWriteRefusal
  | EdgeRefusal
  | PlacementRefusal
  | FieldWriteRefusal
  | TransitionRefusal
  | 'not-found'
  | 'deleted'
  | 'cross-project-parent'
  | 'leaf'
  | 'amends-shape'
  | 'body-capped'
  | 'body-address'
  | 'source-required'
  | 'source-outside'
  | 'no-edge'
  | 'project-root'
  | 'catalog-member'
  | 'status-operation'
  | 'tree-cycle'
  | 'superseded'
  | 'carriers-invalid'
  | 'unknown-project'
  | 'anchor-noop'
  | 'anchor-not-found'
  | 'anchor-ambiguous'
  | AmendmentPayloadRefusal
  | 'cross-project'
  | 'amends-an-amendment'
  | 'amendment-shape'
  | 'verdict-standing'
  | RetagRefusal;
export type AcceptedDocumentRefusal = FloorRefusal | 'batch-ref' | 'body-capped' | 'field-target' | 'not-found';
export type AcceptedRefusal = AcceptedOpRefusal | AcceptedDocumentRefusal;

export class Amendments extends Context.Service<
  Amendments,
  {
    apply(
      ops: readonly AmendmentOp[],
      projectId: number,
      enclosing?: ReadonlyMap<string, number>,
    ): Effect.Effect<BatchAnswer, StoreFailure | GateRefusal<AcceptedRefusal>>;
    runDocument<Op extends { op: string }, Code extends string>(
      ops: readonly Op[],
      dispatch: (op: Op, handles: Handles, index: number) => Effect.Effect<OpOutcome, StoreFailure | GateRefusal<Code>, ActState>,
      enclosing?: ReadonlyMap<string, number>,
      bodyFiles?: ReadonlyMap<number, string | undefined>,
    ): Effect.Effect<BatchAnswer, StoreFailure | GateRefusal<Code | DocumentRefusal>>;
    applyOp(
      op: AmendmentOp,
      handles: Handles,
      projectId: number,
    ): Effect.Effect<OpOutcome, StoreFailure | GateRefusal<AmendmentOpRefusal>, ActState>;
  }
>()('tagma/graph/Amendments') {}
