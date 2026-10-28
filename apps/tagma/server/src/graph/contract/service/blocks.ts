import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { FloorRefusal, GateRefusal, GitRefusal } from '../../../platform/contract/wire/refusal.js';
import type { BlockCreate } from '../wire/creation.js';
import type { EdgeKind } from '../wire/edges.js';
import type { PlacementRefusal } from './sources.js';
import type { TransitionRefusal } from '../wire/lifecycle.js';
import type { ActState } from './transaction.js';
import type { BlockMeasurement, BlockRecord, BlockRow, BlockWrite, EdgeRow } from './acts.js';
import type { Tagged } from '../wire/tags/roles.js';
import type { Delivery } from '../wire/tags/law.js';
import type { NodeActions } from '../wire/tags/actions.js';
import type { TagTable } from '../wire/tags/table.js';
import type { CreationDefaultRefusal } from '../wire/tags/profile.js';
import type { ModuleCard, ModuleWrite } from '../wire/modules.js';
import type { FarAddress, FarTarget } from '../wire/far.js';
import type { ContractId } from '../wire/tags/behaviour.js';
import type { farEdge } from '../../store/tables.js';
import type { SessionRef } from '../../../platform/contract/wire/session.js';
import type { SourceInput } from '../wire/sources.js';

export type BlockEdit = {
  id: number;
  old: string;
  new: string;
  all?: boolean;
};

export type FieldWriteRefusal =
  | 'field-conflict'
  | 'role-conflict'
  | 'field-invalid'
  | 'field-required'
  | 'field-target'
  | 'operation-only'
  | 'layer-forbidden'
  | 'tag-declared'
  | 'tag-incoherent'
  | 'vocabulary-older';

export type TagWriteRefusal = FieldWriteRefusal | 'tag-undeclared';

export type EdgeRefusal = 'edge-undeclared' | 'edge-shape' | 'wait-cycle' | 'superseded' | 'operation-only';

export type BlockCreateRefusal =
  | GitRefusal
  | 'tree-not-measured'
  | CreationDefaultRefusal
  | 'creation-contract'
  | TransitionRefusal
  | 'no-holder'
  | 'claimed-elsewhere'
  | FloorRefusal
  | TagWriteRefusal
  | EdgeRefusal
  | PlacementRefusal
  | 'not-found'
  | 'deleted'
  | 'no-root'
  | 'cross-project-parent'
  | 'leaf'
  | 'amends-missing'
  | 'amends-shape'
  | 'body-capped'
  | 'body-address'
  | 'source-required'
  | 'source-outside'
  | 'carriers-invalid';

export type BlockUpdateRefusal =
  | FloorRefusal
  | FieldWriteRefusal
  | TransitionRefusal
  | 'not-found'
  | 'deleted'
  | 'status-operation'
  | 'project-root'
  | 'no-root'
  | 'cross-project-parent'
  | 'leaf'
  | 'tree-cycle'
  | 'body-capped'
  | 'body-address'
  | 'superseded'
  | 'carriers-invalid'
  | 'operation-only';

export type BlockUpdate = {
  id: number;
  title?: string;
  body?: string;
  status?: string;
  tags?: readonly string[];
  parentId?: number | null;
  ord?: number;
  fields?: Readonly<Record<string, unknown>>;
};

export type RetagRefusal =
  | 'tag-undeclared'
  | 'amends-shape'
  | 'retag-status'
  | 'edge-undeclared'
  | 'edge-shape'
  | 'source-required'
  | 'not-measurable';

export type BlockEditRefusal = BlockUpdateRefusal | 'anchor-empty' | 'anchor-noop' | 'anchor-not-found' | 'anchor-ambiguous';

export type SwitchRefusal = FloorRefusal | 'not-found' | 'deleted' | 'not-rule' | 'field-invalid';

export type DeliveryRefusal = SwitchRefusal | 'delivery-undeclared';

export type EnforceRefusal = FloorRefusal | 'not-found' | 'deleted' | 'not-enforced' | 'enforcement-stale' | 'field-invalid';

export type DeleteRefusal =
  | FloorRefusal
  | 'not-found'
  | 'deleted'
  | 'project-root'
  | 'catalog-member'
  | 'field-invalid'
  | 'carriers-invalid'
  | 'operation-only';

export type RestoreRefusal =
  | FloorRefusal
  | 'operation-only'
  | 'not-found'
  | 'not-deleted'
  | 'parent-deleted'
  | 'journal-unreadable'
  | 'carriers-invalid'
  | 'field-invalid';

export type ModuleRefusal = FloorRefusal | 'not-found' | 'deleted' | 'field-invalid' | 'field-required' | 'tag-undeclared' | 'module-shape';

export type ArrivalRefusal = BlockCreateRefusal | 'relocation-shape';

export type EnforcementWrite = {
  readonly id: number;
  readonly anchors: readonly string[];
  readonly stood: unknown;
  readonly document: Readonly<Record<string, unknown>> | null;
  readonly journal: Readonly<Record<string, unknown>>;
  readonly op?: 'enforce' | 'remeasure';
};

export class Blocks extends Context.Service<
  Blocks,
  {
    create(
      input: BlockCreate & { readonly farEdges?: readonly FarLink[] },
    ): Effect.Effect<BlockWrite, StoreFailure | GateRefusal<BlockCreateRefusal>>;
    arrive(input: Arrival): Effect.Effect<BlockWrite, StoreFailure | GateRefusal<ArrivalRefusal>>;
    update(input: BlockUpdate & { tags?: undefined }): Effect.Effect<BlockWrite, StoreFailure | GateRefusal<BlockUpdateRefusal>>;
    update(input: BlockUpdate): Effect.Effect<BlockWrite, StoreFailure | GateRefusal<BlockUpdateRefusal | RetagRefusal>>;
    edit(input: BlockEdit): Effect.Effect<BlockWrite, StoreFailure | GateRefusal<BlockEditRefusal>>;
    setEnabled(input: { id: number; enabled: boolean }): Effect.Effect<BlockRecord, StoreFailure | GateRefusal<SwitchRefusal>>;
    setDelivery(input: { id: number; delivery: Delivery | null }): Effect.Effect<BlockRecord, StoreFailure | GateRefusal<DeliveryRefusal>>;
    setEnforcement(input: EnforcementWrite): Effect.Effect<BlockRecord, StoreFailure | GateRefusal<EnforceRefusal>>;
    moduleCards(projectId: number): Effect.Effect<readonly ModuleCard[], StoreFailure>;
    writeModules(
      projectId: number,
      plan: readonly ModuleWrite[],
      enforcements: readonly EnforcementWrite[],
    ): Effect.Effect<readonly number[], StoreFailure | GateRefusal<ModuleRefusal | EnforceRefusal>>;
    liveBlock(id: number): Effect.Effect<BlockRow | undefined, StoreFailure>;
    blockById(id: number): Effect.Effect<BlockRow, StoreFailure | GateRefusal<'not-found' | 'deleted'>>;
    rawBlockById(id: number): Effect.Effect<BlockRow, StoreFailure | GateRefusal<'not-found'>>;
    rootBlockOf(projectId: number): Effect.Effect<BlockRow, StoreFailure | GateRefusal<'no-root'>>;
    childrenOf(parentId: number): Effect.Effect<BlockRow[], StoreFailure>;
    collectDescendants(id: number): Effect.Effect<BlockRow[], StoreFailure>;
    nextOrd(parentId: number | null): Effect.Effect<number, StoreFailure>;
    recordOf(row: BlockRow): Effect.Effect<BlockRecord, StoreFailure>;
    details<TRow extends BlockRow>(rows: readonly TRow[]): Effect.Effect<BlockRecord<TRow>[], StoreFailure>;
    written(row: BlockRow, textMoved: boolean): Effect.Effect<BlockWrite, StoreFailure>;
    records<TRow extends { id: number; projectId: number; tags: readonly string[] }, TFact extends keyof BlockMeasurement>(
      rows: readonly TRow[],
      facts: readonly TFact[],
    ): Effect.Effect<Array<TRow & Pick<BlockMeasurement, TFact> & { readonly actions: NodeActions }>, StoreFailure>;
  }
>()('tagma/graph/Blocks') {}

export type EdgeNode = {
  readonly id?: number;
  readonly uuid: string;
  readonly projectId: number;
  readonly tags: readonly string[];
};

export type FarType = { readonly key: string; readonly typeId: string | null };

export type FarBlock = {
  readonly target: FarTarget;
  readonly types: readonly FarType[];
  readonly lineage: readonly FarType[];
  readonly contracts: readonly ContractId[];
};

export type FarLink = { readonly kind: EdgeKind; readonly end: FarBlock };

export type CarriedFar = { readonly kind: EdgeKind; readonly target: FarTarget; readonly end: FarBlock | null };

export type CarriedBlock = {
  readonly uuid: string;
  readonly parent: string | null;
  readonly ord: number;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly fields: Readonly<Record<string, unknown>>;
  readonly sessions: readonly { readonly field: string; readonly writer: SessionRef }[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly sources: readonly SourceInput[];
  readonly links: readonly { readonly kind: EdgeKind; readonly to: string }[];
  readonly far: readonly CarriedFar[];
};

export type Arrival = {
  readonly projectId: number;
  readonly parentId: number;
  readonly from: string;
  readonly blocks: readonly CarriedBlock[];
};

export type GraphAddress = { readonly graph: string; readonly label: string };

export type FarEdgeRow = typeof farEdge.$inferSelect;

export class Edges extends Context.Service<
  Edges,
  {
    link(input: {
      fromId: number;
      kind: EdgeKind;
      toId: number;
    }): Effect.Effect<void, StoreFailure | GateRefusal<EdgeRefusal | FloorRefusal | 'not-found' | 'deleted' | 'no-root'>>;
    linkFar(input: {
      fromId: number;
      kind: EdgeKind;
      end: FarBlock;
    }): Effect.Effect<void, StoreFailure | GateRefusal<EdgeRefusal | FloorRefusal | 'not-found' | 'deleted'>>;
    assertEdge(from: EdgeNode, to: BlockRow, kind: EdgeKind): Effect.Effect<void, StoreFailure | GateRefusal<EdgeRefusal>>;
    assertFarEdge(from: EdgeNode, end: FarBlock, kind: EdgeKind): Effect.Effect<void, StoreFailure | GateRefusal<EdgeRefusal>>;
    assertRetagged(
      node: BlockRow,
      tags: readonly string[],
    ): Effect.Effect<void, StoreFailure | GateRefusal<'edge-undeclared' | 'edge-shape' | 'not-found'>>;
    farBlockOf(row: BlockRow, kind: EdgeKind): Effect.Effect<FarBlock, StoreFailure | GateRefusal<'superseded' | 'no-root'>>;
    farEndOf(node: EdgeNode): Effect.Effect<FarBlock, StoreFailure | GateRefusal<'no-root'>>;
    assertCarried(
      from: EdgeNode,
      kind: EdgeKind,
      to: EdgeNode | FarBlock | null,
    ): Effect.Effect<void, StoreFailure | GateRefusal<'edge-undeclared' | 'edge-shape'>>;
    readdress(input: {
      projectId: number;
      from: string;
      to: GraphAddress;
      uuids: readonly string[];
    }): Effect.Effect<number, StoreFailure | GateRefusal<FloorRefusal>>;
    unlink(input: {
      fromId: number;
      kind: EdgeKind;
      toId: number;
    }): Effect.Effect<void, StoreFailure | GateRefusal<FloorRefusal | 'not-found' | 'operation-only' | 'no-edge' | 'no-root'>>;
    unlinkFar(input: {
      fromId: number;
      kind: EdgeKind;
      to: readonly FarAddress[];
    }): Effect.Effect<void, StoreFailure | GateRefusal<FloorRefusal | 'not-found' | 'operation-only' | 'no-edge'>>;
    of(projectId: number, within?: ReadonlySet<number>): Effect.Effect<EdgeRow[], StoreFailure>;
    farOf(projectId: number): Effect.Effect<FarEdgeRow[], StoreFailure>;
    farFrom(fromId: number, kind: EdgeKind): Effect.Effect<FarEdgeRow[], StoreFailure>;
    insertEdgeRow(fromId: number, kind: EdgeKind, toId: number): Effect.Effect<boolean, StoreFailure, ActState>;
    insertEdge(fromId: number, kind: EdgeKind, toId: number): Effect.Effect<void, StoreFailure, ActState>;
    insertFarEdge(fromId: number, kind: EdgeKind, target: FarTarget): Effect.Effect<void, StoreFailure, ActState>;
  }
>()('tagma/graph/Edges') {}

export type Departure = { readonly taken: BlockRow; readonly resting: BlockRecord };

export class Trash extends Context.Service<
  Trash,
  {
    delete(input: { id: number }): Effect.Effect<BlockRecord, StoreFailure | GateRefusal<DeleteRefusal>>;
    depart(input: {
      id: number;
      to: GraphAddress;
    }): Effect.Effect<Departure, StoreFailure | GateRefusal<DeleteRefusal | 'relocation-shape'>>;
    restore(input: { id: number }): Effect.Effect<BlockRecord, StoreFailure | GateRefusal<RestoreRefusal>>;
    reclaim(input: { id: number; uuid: string }): Effect.Effect<BlockRecord, StoreFailure | GateRefusal<RestoreRefusal>>;
    roots(projectId?: number, among?: readonly number[]): Effect.Effect<BlockRecord[], StoreFailure>;
  }
>()('tagma/graph/Trash') {}
