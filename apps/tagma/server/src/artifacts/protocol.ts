import { Schema } from 'effect';
import type { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { Draft, PageVideos, PublishPage, Removal, ShelfSelection, ShelfPage } from './contract/service/shelf.js';
import type { ArtifactPage, ArtifactRecord, ShelfState, ThreadPages } from './contract/wire/artifacts.js';

export type CompactionFailure = { readonly recovered: boolean; readonly failure: string };

export type SelectionUpdate = { readonly id: number; readonly value: ThreadPages };

export type Published = {
  readonly record: ArtifactRecord;
  readonly kept: readonly string[];
  readonly timelineProblem: string | null;
  readonly updates: readonly SelectionUpdate[];
  readonly maintenance: { readonly records: number; readonly live: number } | null;
};

export type Withdrawn = {
  readonly removal: Removal;
  readonly updates: readonly SelectionUpdate[];
  readonly maintenance: { readonly records: number; readonly live: number } | null;
};

export type ShelfJobs = {
  readonly remove: {
    readonly input: string;
    readonly output: Withdrawn;
    readonly error: GateRefusal<'artifact-unknown'>;
  };
  readonly publish: {
    readonly input: PublishPage;
    readonly output: Published;
    readonly error: GateRefusal<'no-such-page' | 'empty-page' | 'artifact-index-unavailable'>;
  };
  readonly draft: {
    readonly input: string;
    readonly output: Draft;
    readonly error: GateRefusal<'no-such-page' | 'empty-page'>;
  };
  readonly list: {
    readonly input: ShelfSelection;
    readonly output: ShelfPage;
    readonly error: GateRefusal<'cursor-stale'>;
  };
  readonly page: {
    readonly input: { readonly id: string; readonly version?: string | undefined };
    readonly output: ArtifactPage | null;
    readonly error: never;
  };
  readonly versions: { readonly input: string; readonly output: readonly string[]; readonly error: never };
  readonly state: { readonly input: string; readonly output: ShelfState; readonly error: never };
  readonly videos: { readonly input: string; readonly output: PageVideos; readonly error: never };
  readonly pages: {
    readonly input: { readonly threads: readonly string[]; readonly limit: number };
    readonly output: ThreadPages;
    readonly error: never;
  };
  readonly follow: {
    readonly input: { readonly id: number; readonly threads: readonly string[]; readonly limit: number };
    readonly output: ThreadPages;
    readonly error: never;
  };
  readonly unfollow: { readonly input: number; readonly output: null; readonly error: never };
  readonly maintain: {
    readonly input: null;
    readonly output: CompactionFailure | null;
    readonly error: never;
  };
};

export type ShelfJob = keyof ShelfJobs;
export type ShelfRequest = { [K in ShelfJob]: { readonly kind: K; readonly input: ShelfJobs[K]['input'] } }[ShelfJob];
export type ShelfAsk = {
  readonly id: number;
  readonly root: string;
  readonly origin: string;
  readonly request: ShelfRequest;
};

export const shelfRefusalSchema = Schema.Struct({
  code: Schema.String,
  reason: Schema.String,
  unblock: Schema.NonEmptyArray(Schema.String),
});

export type ShelfReply = { readonly id: number } & (
  | { readonly kind: 'done'; readonly value: ShelfJobs[ShelfJob]['output'] }
  | { readonly kind: 'refused'; readonly refusal: typeof shelfRefusalSchema.Type }
  | { readonly kind: 'failed'; readonly reason: string }
);

export type ShelfMessage = ShelfReply | { readonly kind: 'ready' };
