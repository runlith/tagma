import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { SessionRow, WriterRef } from '../../../platform/contract/service/writers.js';
import type { HolderStanding } from '../wire/holders.js';
import type { SessionRef } from '../../../platform/contract/wire/session.js';
import type { HeldTask } from './serving.js';
import type { FloorRefusal, GateRefusal, GitRefusal, OpenRefusal, ReferenceRefusal } from '../../../platform/contract/wire/refusal.js';
import type { BlockRecord, BlockRow, BlockWrite, SourceRow } from './acts.js';
import type { BlockCreateRefusal, BlockEditRefusal, EdgeRefusal, RetagRefusal, LinkTarget, BlockLink } from './blocks.js';
import type { BlockPosition } from './reads.js';
import type { PageSlice } from '@runlith/paging';
import type { DocumentOp, BatchInput } from '../wire/batch.js';
import type { ActState } from './transaction.js';
import type { HeldWork } from '../wire/operations/shared.js';
import type { ThreadAct } from '../wire/threadWork.js';
import type { ProjectRefusal } from '../../../projects/contract/wire/project.js';
import type { EdgeKind } from '../wire/edges.js';
import type { Crowded } from '../wire/answers.js';

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
    apply(
      input: BatchInput,
      projectId: number,
      operator?: boolean,
      scope?: DocumentScope,
    ): Effect.Effect<BatchAnswer, StoreFailure | GateRefusal>;
    held(input: BatchInput): Effect.Effect<readonly HeldWork[], StoreFailure | GateRefusal<'batch-source'>>;
  }
>()('tagma/graph/Batch') {}

export type OpOutcome = BlockWrite | BlockRecord | SourceRow | { ok: true };

export type BatchAnswer = {
  ops: OpOutcome[];
  ids: Record<string, string>;
  bodyFiles?: Record<number, string>;
  specs?: readonly WorklessSpec[];
  crowded?: readonly Crowded[];
};

export type Handles = {
  readonly declared: Map<string, number>;
  readonly minted: ReadonlyMap<string, string>;
  readonly awaiting: Set<number>;
  readonly references: DocumentReferences;
};

export type DocumentRefRefusal =
  | ReferenceRefusal
  | OpenRefusal
  | ProjectRefusal
  | GitRefusal
  | 'global-missing'
  | 'no-home'
  | 'place-mismatch'
  | 'cross-project'
  | 'not-found'
  | 'batch-ref';

export type DocumentScope = {
  readonly references: DocumentReferences;
  readonly link: (input: BlockLink) => Effect.Effect<void, GateRefusal | StoreFailure>;
  readonly unlink: (input: BlockLink) => Effect.Effect<void, GateRefusal | StoreFailure>;
};

export type DocumentReferences = {
  readonly resolve: (name: string) => Effect.Effect<number, GateRefusal<DocumentRefRefusal> | StoreFailure>;
  readonly target: (
    name: string,
    projectId: number,
    kind: EdgeKind,
  ) => Effect.Effect<LinkTarget, GateRefusal<DocumentRefRefusal | 'superseded' | 'deleted'> | StoreFailure>;
};

export type DocumentRefusal = FloorRefusal | 'batch-shape' | 'batch-ref' | 'body-capped' | 'field-target' | 'not-found';

export type DocumentOpRefusal =
  | DocumentRefRefusal
  | BlockCreateRefusal
  | BlockEditRefusal
  | RetagRefusal
  | EdgeRefusal
  | FloorRefusal
  | 'no-edge'
  | 'project-root'
  | 'catalog-member'
  | 'deleted';

export class Documents extends Context.Service<
  Documents,
  {
    runDocument<Op extends { op: string }, Code extends string>(
      ops: readonly Op[],
      dispatch: (op: Op, handles: Handles, index: number) => Effect.Effect<OpOutcome, StoreFailure | GateRefusal<Code>, ActState>,
      bodyFiles?: ReadonlyMap<number, string | undefined>,
      references?: DocumentReferences,
    ): Effect.Effect<BatchAnswer, StoreFailure | GateRefusal<Code | DocumentRefusal>>;
    applyOp(
      op: DocumentOp,
      handles: Handles,
      projectId: number,
    ): Effect.Effect<OpOutcome, StoreFailure | GateRefusal<DocumentOpRefusal>, ActState>;
  }
>()('tagma/graph/Documents') {}
