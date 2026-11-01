import { Context, type Effect } from 'effect';
import type { PageSlice } from '@runlith/paging';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal, ReferenceRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ZonePage } from '../../voice/zonePage.js';
import type { BlockMeasurement, BlockRecord, BlockRow, EdgeRow, SourceRow } from './acts.js';
import type { BlockQuery } from '../wire/query.js';
import type { TypeSelector } from '../wire/tags/selector.js';
import type { BlockDiff, BlockListRow, BlockMark, BlockPage, SearchPage, ViewResults } from '../wire/reads.js';
import type { SubtreeShape } from '../wire/standing.js';
import type { AnsweredCheck } from '../wire/rows.js';
import { type BlockEnding } from './work.js';
import type { FarEnd, RefElsewhere } from '../wire/far.js';
import type { FarHeld } from './foreign.js';
import type { BlockReference } from '../wire/references.js';

export type SelectionRefusal = ReferenceRefusal | 'not-found' | 'source-outside' | 'query-shape';

export type QueryPage = BlockPage & { readonly nextCursor: string | null };

export type BlockPosition = readonly [number | null, number];

export type ReadyAlso = { readonly ids: readonly number[]; readonly uuids: readonly string[] };

export type ReadyPageFilter = {
  readonly projectId: number | undefined;
  readonly scopeId: number | undefined;
  readonly after: BlockPosition | undefined;
  readonly rows: number;
  readonly also?: ReadyAlso | undefined;
};

export type BlockTreeRow = Omit<BlockRecord, 'body'>;

export type BlockTitle = {
  readonly name: string;
  readonly uuid: string;
  readonly title: string;
  readonly projectId: number;
  readonly rowKey?: number;
};

export class Selection extends Context.Service<
  Selection,
  {
    rows(q: BlockQuery, projectId?: number): Effect.Effect<BlockRow[], StoreFailure | GateRefusal<SelectionRefusal>>;
    rowsPage(
      q: BlockQuery,
      projectId: number | undefined,
      after: BlockPosition | undefined,
      rows: number,
    ): Effect.Effect<PageSlice<BlockRow, number>, StoreFailure | GateRefusal<SelectionRefusal>>;
    query(projectId: number, q: BlockQuery): Effect.Effect<BlockPage, StoreFailure | GateRefusal<SelectionRefusal>>;
    queryPage(
      projectId: number,
      q: BlockQuery,
      cursor?: string,
    ): Effect.Effect<QueryPage, StoreFailure | GateRefusal<SelectionRefusal | 'bad-cursor' | 'cursor-stale'>>;
    list<TFact extends keyof BlockMeasurement>(
      rows: readonly BlockRow[],
      facts: readonly TFact[],
    ): Effect.Effect<BlockListRow[], StoreFailure>;
    ready(filter?: {
      projectId?: number;
      scopeId?: number;
      among?: readonly number[];
    }): Effect.Effect<BlockRecord[], StoreFailure | GateRefusal<SelectionRefusal>>;
    readyPage(filter: ReadyPageFilter): Effect.Effect<PageSlice<BlockRecord, number>, StoreFailure | GateRefusal<SelectionRefusal>>;
    held(filter: {
      readonly projectId: number | undefined;
      readonly scopeId: number | undefined;
    }): Effect.Effect<readonly FarHeld[], StoreFailure>;
    roots(projectId: number): Effect.Effect<BlockRecord[], StoreFailure>;
    tree(projectId: number): Effect.Effect<BlockTreeRow[], StoreFailure>;
    subtree(scopeId: number): Effect.Effect<Set<number>, StoreFailure>;
    outline(
      rootId: number,
      depth: number,
      all: boolean,
    ): Effect.Effect<
      {
        rows: BlockRow[];
        children: Map<number, number[]>;
        shapes: Map<number, SubtreeShape>;
      },
      StoreFailure
    >;
    shape(rootId: number): Effect.Effect<SubtreeShape, StoreFailure>;
    records(ids: readonly number[]): Effect.Effect<BlockRecord[], StoreFailure>;
    titles(names: readonly string[]): Effect.Effect<BlockTitle[], StoreFailure>;
  }
>()('tagma/graph/Selection') {}

export type RankingSearchInput = {
  query: string;
  projectId?: number;
  scopeId?: number;
  tag?: string;
  selector?: TypeSelector;
  status?: string;
  path?: string;
  history?: boolean;
  cursor?: string;
  limit?: number;
};

export type FirstPageInput = Omit<RankingSearchInput, 'path' | 'cursor'>;

export class Ranking extends Context.Service<
  Ranking,
  {
    search(
      input: RankingSearchInput,
    ): Effect.Effect<SearchPage, StoreFailure | GateRefusal<'bad-cursor' | 'cursor-stale' | 'source-outside' | 'query-shape'>>;
    firstPage(input: FirstPageInput): Effect.Effect<SearchPage, StoreFailure | GateRefusal<'query-shape'>>;
  }
>()('tagma/graph/Ranking') {}

export type HistoryRefusal = GateRefusal<'not-found' | 'journal-unreadable'>;

export class History extends Context.Service<
  History,
  {
    bodyAt(blockId: number, watermark: number): Effect.Effect<string | null, StoreFailure | HistoryRefusal>;
    positionAt(blockId: number, seen: Date): Effect.Effect<number, StoreFailure>;
    blockDiff(input: { blockId: number; from: number; to: number }): Effect.Effect<BlockDiff, StoreFailure | HistoryRefusal>;
    marks(input: {
      projectId: number;
      scopeId?: number;
      from: number;
      to: number;
    }): Effect.Effect<{ marks: BlockMark[]; blocks: BlockRecord[] }, StoreFailure | HistoryRefusal>;
  }
>()('tagma/graph/History') {}

export type DetailEdge = Pick<EdgeRow, 'kind' | 'createdBySessionId' | 'createdAt'> & {
  readonly fromId: number | null;
  readonly toId: number | null;
  readonly fromUuid: string | null;
  readonly toUuid: string | null;
  readonly far?: FarEnd;
};

export type BlockDetail = BlockRecord & {
  edgesOut: DetailEdge[];
  edgesIn: DetailEdge[];
  edgesInUnread: readonly string[];
  refsOut: string[];
  refsOutDetails: BlockReference[];
  refsElsewhere: readonly RefElsewhere[];
  refsAbsent: string[];
  refsIn: string[];
  refsInDetails: BlockReference[];
  restingIn: {
    edges: DetailEdge[];
    refs: string[];
    refsDetails: BlockReference[];
  };
  sources: SourceRow[];
  reach: string | null;
  ending: BlockEnding | null;
  author: number | null;
  answeredBy: string | null;
  answeredCommit: string | null;
  answeredCheck: AnsweredCheck | null;
  results: ViewResults | null;
  shape: SubtreeShape;
  children: BlockDetail[];
};

export class BlockReads extends Context.Service<
  BlockReads,
  {
    show(
      id: number,
      depth: number,
      all?: boolean,
    ): Effect.Effect<BlockDetail, StoreFailure | GateRefusal<SelectionRefusal | 'not-found' | 'deleted' | 'field-invalid'>>;
    zone(
      id: number,
      cursor?: string,
      deliveredTags?: ReadonlySet<string>,
    ): Effect.Effect<
      ZonePage & { total: number; deliveredTags: readonly string[] },
      StoreFailure | GateRefusal<'not-found' | 'deleted' | 'bad-cursor'>
    >;
  }
>()('tagma/graph/BlockReads') {}
