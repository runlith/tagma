import { Effect } from 'effect';
import { workerLink } from '@runlith/utils/worker';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { FarAddress, Phase } from '../contract/wire/far.js';

export type IndexedCopyAsk = { readonly mirror: string; readonly projectId: number };

export type IndexQuestion =
  | { readonly ask: 'titles'; readonly names: readonly string[] }
  | { readonly ask: 'targets'; readonly targets: readonly FarAddress[]; readonly contract: string }
  | { readonly ask: 'pointing'; readonly graph: string; readonly uuids: readonly string[] | null; readonly contract: string }
  | { readonly ask: 'outgoing'; readonly graph: string; readonly uuids: readonly string[]; readonly kind: string }
  | {
      readonly ask: 'work';
      readonly graph: string;
      readonly uuids: readonly string[];
      readonly kinds: readonly string[];
      readonly contract: string;
    };

export type IndexAsk = {
  readonly id: number;
  readonly copies: readonly IndexedCopyAsk[];
  readonly question: IndexQuestion;
};

export type IndexedName = { readonly name: string; readonly uuid: string; readonly title: string; readonly trashed: boolean };

export type CopyRoot = { readonly uuid: string; readonly title: string };

export type TargetRow = {
  readonly uuid: string;
  readonly title: string;
  readonly trashed: boolean;
  readonly superseded: boolean;
  readonly phase: Phase | null;
};

export type PointerRow = {
  readonly from: string;
  readonly title: string;
  readonly kind: string;
  readonly to: string;
  readonly at: number;
  readonly superseded: boolean;
  readonly phase: Phase | null;
};

export type OutgoingRow = { readonly from: string; readonly graph: string; readonly to: string };

export type WorkRow = { readonly uuid: string; readonly open: boolean };

type Missing = { readonly kind: 'unindexed' } | { readonly kind: 'unreadable'; readonly reason: string };

export type CopyIndexReading = Missing | { readonly kind: 'titles'; readonly rows: readonly IndexedName[] };

export type CopyRead<Row> =
  | Missing
  | { readonly kind: 'read'; readonly root: CopyRoot | null; readonly phased: boolean; readonly rows: readonly Row[] };

export type IndexAnswer = { readonly id: number; readonly readings: readonly unknown[] };

const failed = (reason: string) =>
  new GateRefusal('graph-pool', `the graph copy index reader is unavailable: ${reason}`, [
    'retry against the server once its copy index reader can run',
  ]);

export const copyIndex = () => {
  const reader = workerLink<IndexAsk, IndexAnswer>(
    'graph copy index reader',
    () => new Worker(new URL('./copyIndex.worker.ts', import.meta.url), { type: 'module' }),
  );

  const ask = <Reading>(copies: readonly IndexedCopyAsk[], question: IndexQuestion) =>
    reader
      .ask((id) => ({ id, copies, question }))
      .pipe(
        Effect.mapError((gone) => failed(gone.reason)),
        Effect.map((answer) => answer.readings as readonly Reading[]),
      );

  const unread = <Reading>(copies: readonly IndexedCopyAsk[], empty: Reading) => Effect.succeed(copies.map(() => empty));

  return {
    read: (copies: readonly IndexedCopyAsk[], names: readonly string[]) =>
      (copies.length === 0 || names.length === 0
        ? unread<CopyIndexReading>(copies, { kind: 'titles', rows: [] })
        : ask<CopyIndexReading>(copies, { ask: 'titles', names })
      ).pipe(Effect.withSpan('GraphPool.titles.index', { attributes: { copies: copies.length, names: names.length } })),
    far: <Row>(copies: readonly IndexedCopyAsk[], question: Exclude<IndexQuestion, { readonly ask: 'titles' }>) =>
      (copies.length === 0 ? unread<CopyRead<Row>>(copies, { kind: 'unindexed' }) : ask<CopyRead<Row>>(copies, question)).pipe(
        Effect.withSpan('GraphPool.foreign.index', { attributes: { copies: copies.length, ask: question.ask } }),
      ),
    close: () => reader.close('the graph pool closed'),
  };
};
