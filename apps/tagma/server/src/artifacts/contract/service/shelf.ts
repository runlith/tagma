import { Context, type Effect, type Stream } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ArtifactPage, ArtifactRecord, ShelfState, ThreadPages, VideoScale } from '../wire/artifacts.js';
import type { Timeline } from '../wire/timeline.js';

export type PublishPage = {
  readonly path: string;
  readonly thread: string;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
};

export type ShelfKey = {
  readonly epoch: number;
  readonly snapshot: number;
  readonly total: number;
  readonly seq: number;
};

export type ShelfSelection = { readonly limit: number; readonly after?: ShelfKey | undefined };

export type Publication = { readonly record: ArtifactRecord; readonly timelineProblem: string | null };

export type Draft = {
  readonly id: string;
  readonly html: string;
  readonly timeline: Timeline | null;
  readonly timelineProblem: string | null;
};

export type KeptVideo = {
  readonly version: string;
  readonly fps: number;
  readonly scale: VideoScale;
  readonly frames: number;
  readonly bytes: number;
};

export type PageVideos = { readonly kept: readonly KeptVideo[]; readonly parts: readonly string[] };

export type Removal = { readonly versions: number; readonly videos: number };

export type ShelfPage = {
  readonly rows: readonly { readonly record: ArtifactRecord; readonly key: ShelfKey }[];
  readonly total: number;
  readonly more: boolean;
};

export class ShelfPlace extends Context.Service<
  ShelfPlace,
  {
    readonly root: string;
    readonly origin: string;
  }
>()('tagma/artifacts/ShelfPlace') {}

export class ArtifactStore extends Context.Service<
  ArtifactStore,
  {
    publish(input: PublishPage): Effect.Effect<Publication, GateRefusal<'no-such-page' | 'empty-page' | 'artifact-index-unavailable'>>;
    remove(id: string): Effect.Effect<Removal, GateRefusal<'artifact-unknown'>>;
    draft(path: string): Effect.Effect<Draft, GateRefusal<'no-such-page' | 'empty-page'>>;
    list(request: ShelfSelection): Effect.Effect<ShelfPage, GateRefusal<'cursor-stale'>>;
    page(id: string, version?: string): Effect.Effect<ArtifactPage | null>;
    versions(id: string): Effect.Effect<readonly string[]>;
    pages(threads: readonly string[], limit: number): Effect.Effect<ThreadPages>;
    follow(threads: readonly string[], limit: number): Stream.Stream<ThreadPages>;
    followPage(id: string): Stream.Stream<ShelfState>;
    videos(id: string): Effect.Effect<PageVideos>;
    videoFile(id: string, version: string, name: string): string | null;
  }
>()('tagma/artifacts/ArtifactStore') {}
