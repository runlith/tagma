import { Context, type Effect } from 'effect';
import type { PageSlice } from '@runlith/paging';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { FloorRefusal, GateRefusal, GitRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ActState } from './transaction.js';
import type { SourceInput, SourceKind } from '../wire/sources.js';
import type { BlockRecord, BlockRow, SourceRow } from './acts.js';

export type PlaceSource = { source: SourceRow; block: BlockRecord; area: { name: string; title: string } };

export type PlacePosition = readonly [symbol: string, blockId: number, sourceId: number];

export type SourceRelocation = { blockId: number; from: string; to: string };

export type PlacementRefusal =
  | FloorRefusal
  | 'not-measurable'
  | 'symbol-shape'
  | 'symbol-missing'
  | 'source-outside'
  | 'duplicate-source'
  | 'not-found'
  | 'unknown-project'
  | 'operation-only';

export class Sources extends Context.Service<
  Sources,
  {
    attach(input: {
      blockId: number;
      kind: SourceKind;
      ref: string;
      symbol?: string;
      fromId?: number;
    }): Effect.Effect<
      SourceRow,
      StoreFailure | GateRefusal<PlacementRefusal | 'illegal-kind' | 'self-transfer' | 'no-source' | 'source-required' | 'deleted'>
    >;
    place(owner: BlockRow, input: SourceInput): Effect.Effect<SourceRow, StoreFailure | GateRefusal<PlacementRefusal>, ActState>;
    unanchor(input: {
      blockId: number;
      kind: SourceKind;
      ref: string;
      symbol?: string;
    }): Effect.Effect<
      void,
      | StoreFailure
      | GateRefusal<
          | FloorRefusal
          | 'illegal-kind'
          | 'source-outside'
          | 'symbol-shape'
          | 'no-source'
          | 'source-required'
          | 'not-found'
          | 'deleted'
          | 'operation-only'
        >
    >;
    relocate(input: {
      projectId: number;
      from: string;
      to: string;
    }): Effect.Effect<
      SourceRelocation[],
      | StoreFailure
      | GateRefusal<
          | FloorRefusal
          | 'relocation-shape'
          | 'relocation-noop'
          | 'symbol-missing'
          | 'source-outside'
          | 'no-source'
          | 'duplicate-source'
          | 'not-found'
          | 'unknown-project'
        >
    >;
    of(blockId: number): Effect.Effect<SourceRow[], StoreFailure>;
    byBlock(blockIds: readonly number[]): Effect.Effect<ReadonlyMap<number, SourceRow[]>, StoreFailure>;
    atPlacePage(
      projectId: number,
      place: string,
      after: PlacePosition | undefined,
      rows: number,
    ): Effect.Effect<PageSlice<PlaceSource, number>, StoreFailure>;
    ownersOf(
      projectId: number,
      spelling: string,
      excluding?: number,
    ): Effect.Effect<BlockRecord[], StoreFailure | GateRefusal<'not-found' | 'source-outside' | GitRefusal>>;
  }
>()('tagma/graph/Sources') {}
