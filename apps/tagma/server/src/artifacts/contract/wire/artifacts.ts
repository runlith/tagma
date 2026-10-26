import { Schema } from 'effect';
import { timelineSchema } from './timeline.js';

export const ARTIFACT_ID = /^[0-9a-f]{12}$/u;

export const artifactIdSchema = Schema.String.check(Schema.isPattern(ARTIFACT_ID));

export const artifactManifestSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  sourcePath: Schema.String,
  publishedAt: Schema.String,
  timeline: Schema.optional(Schema.NullOr(timelineSchema)),
});

export type ArtifactManifest = typeof artifactManifestSchema.Type;

export const artifactRowSchema = Schema.Struct({
  ...artifactManifestSchema.fields,
  timeline: Schema.NullOr(timelineSchema),
  version: Schema.String,
  versions: Schema.Int,
  url: Schema.String,
});

export type ArtifactRecord = typeof artifactRowSchema.Type;

export const versionAddress = (record: { readonly url: string; readonly version: string }): string => `${record.url}/v/${record.version}`;

export type ArtifactPage = { readonly record: ArtifactRecord; readonly html: string };

export const threadPageSchema = Schema.Struct({
  thread: Schema.String,
  artifact: artifactRowSchema,
});

export type ThreadPage = typeof threadPageSchema.Type;

export const threadPagesSchema = Schema.Struct({
  pages: Schema.Array(threadPageSchema),
  total: Schema.Int,
});

export type ThreadPages = typeof threadPagesSchema.Type;

export const VIDEO_SCALES = [1, 2] as const;

export type VideoScale = (typeof VIDEO_SCALES)[number];

export const VIDEO_FILE = /^video-(\d+)-([12])x\.mp4$/u;

export const videoName = (fps: number, scale: VideoScale): string => `video-${fps}-${scale}x.mp4`;

export const videoSchema = Schema.Struct({
  job: Schema.String,
  version: Schema.String,
  fps: Schema.Int,
  scale: Schema.Literals(VIDEO_SCALES),
  state: Schema.Literals(['queued', 'drawing', 'ready', 'failed']),
  frames: Schema.Int,
  total: Schema.Int,
  url: Schema.NullOr(Schema.String),
  bytes: Schema.NullOr(Schema.Int),
  problem: Schema.NullOr(Schema.String),
});

export type Video = typeof videoSchema.Type;

export const shelfStateSchema = Schema.Struct({
  current: Schema.NullOr(artifactRowSchema),
  kept: Schema.Array(Schema.String),
});

export type ShelfState = typeof shelfStateSchema.Type;

export const pageStateSchema = Schema.Struct({
  ...shelfStateSchema.fields,
  videos: Schema.Array(videoSchema),
});

export type PageState = typeof pageStateSchema.Type;
