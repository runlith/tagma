import { family, PAGE_CURSOR } from '@runlith/paging';
import { Schema } from 'effect';
import { arms, type DeclaredAnswer, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { artifactIdSchema, artifactRowSchema, VIDEO_SCALES, videoSchema } from './artifacts.js';
import { timelineSchema } from './timeline.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';

export const ARTIFACT_ROWS = {
  ...family('artifacts', 1, 'json', { text: 712, json: 712 }, 'ceiling', () => ({
    id: 'x'.repeat(12),
    title: 'x'.repeat(80),
    description: 'x'.repeat(240),
    sourcePath: 'x'.repeat(120),
    publishedAt: '2026-09-28T21:36:17.077Z',
    timeline: { v: 1, duration: 300, fps: 60, width: 3840, height: 2160 },
    version: '20260928T213617077Z-00',
    versions: 20,
    url: `http://127.0.0.1:65535/a/${'x'.repeat(12)}/`,
  })),
  reserveBytes: 256,
};

export const FRAMES_ASKED = 12;

export const FRAME_WIDTH = 960;

export const RENDER_REFUSALS = ['page-failed', 'browser-unavailable', 'host-away'] as const;

export type RenderRefusal = (typeof RENDER_REFUSALS)[number];

export const FILM_REFUSALS = [...RENDER_REFUSALS, 'codec-unavailable'] as const;

export type FilmRefusal = (typeof FILM_REFUSALS)[number];

const VIDEO_JOB = Schema.String.check(Schema.isPattern(/^[0-9a-f]{12}$/u));

export const ARTIFACT_OPERATIONS = {
  list_artifacts: operation('list_artifacts', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    tool: { capability: 'artifacts' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    meaning:
      'List the pages this server hosts, newest publish first, each with its address, its current version and how many versions it keeps.',
    grammar:
      'A page of rows with the total; `next` is the cursor that continues the walk, null on the last page. A walk reads the shelf as it stood at its first page: a page published or republished while you walk changes nothing it answers. When the shelf is compacted, or a version the walk still needs is pruned, the cursor refuses `cursor-stale`; ask again with no cursor.',
    input: Schema.Struct({ limit: limitOf(ARTIFACT_ROWS), cursor: PAGE_CURSOR }),
    answer: arms({
      listed: {
        artifacts: Schema.Array(artifactRowSchema),
        shown: Schema.Int,
        total: Schema.Int,
        next: Schema.NullOr(Schema.String),
        complete: Schema.Boolean,
      },
    }),
    refusals: ['bad-cursor', 'cursor-stale'],
    effect: 'read',
    identity: 'none',
    page: ARTIFACT_ROWS,
    subjects: () => [],
    confirmation: () => ({ summary: 'List the hosted pages?' }),
    confirmLabel: 'List pages',
    presentation: { running: 'Listing the hosted pages', done: 'Listed the hosted pages' },
  }),
  read_artifact_frames: operation('read_artifact_frames', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    tool: { capability: 'artifacts' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    meaning:
      'Draw frames of a page that declares a timeline, as the player and the exported video draw them, and answer each as a PNG at most 960 px wide: a page file before it is published, or a version on the shelf.',
    grammar: `Name the page by \`path\` — the file as it stands, published or not; drawing it publishes nothing — or by \`page\` with an optional \`version\` (the current one by default). \`frames\` lists up to ${FRAMES_ASKED} frame numbers k from 0 to N−1, where N = round(duration · fps) and frame k stands at k / fps. Each frame is kept in a file the answer names, and reaches the agent as an image. A page that throws or fails to get ready refuses \`page-failed\` with the exception; the first call may install the browser first.`,
    input: Schema.Struct({
      path: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'The page file to draw; a relative path resolves in your scratch.',
      }),
      page: Schema.optional(artifactIdSchema).annotate({ description: 'The id of a page on the shelf.' }),
      version: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'A version the shelf keeps of `page`; the current one when omitted.',
      }),
      frames: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
        .check(Schema.isBetweenLength(1, FRAMES_ASKED))
        .annotate({ description: `The frame numbers k to draw, at most ${FRAMES_ASKED}.` }),
    }),
    answer: arms({
      drawn: {
        id: Schema.String,
        version: Schema.NullOr(Schema.String),
        timeline: timelineSchema,
        frames: Schema.Array(
          Schema.Struct({ k: Schema.Int, t: Schema.Finite, path: Schema.String, width: Schema.Int, height: Schema.Int }),
        ),
      },
    }),
    refusals: ['page-unnamed', 'no-such-page', 'empty-page', 'artifact-unknown', 'no-timeline', 'frame-out-of-range', ...RENDER_REFUSALS],
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: () => ({ summary: 'Draw frames of the page?' }),
    confirmLabel: 'Draw frames',
    presentation: { running: 'Drawing frames of the page', done: 'Drew frames of the page' },
  }),
  export_artifact_video: operation('export_artifact_video', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    tool: { capability: 'artifacts' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    meaning:
      'Export a page on the shelf that declares a timeline as an H.264 MP4 video kept with its version, frame for frame as the player draws it.',
    grammar:
      'Answers at once with the job: `queued` while other exports hold the machine, `drawing` with the frames done of the total, `ready` with the video address and its file. Calling again with the same page, version and scale joins the job under way or answers the finished video without drawing it again; the page state the card follows shows the same progress. `scale` 2 draws every frame at twice the pixels of the declared size. Stop a job with cancel_artifact_video; a cancelled job leaves no file. The video is kept with its version and goes when the shelf prunes that version.',
    input: Schema.Struct({
      page: artifactIdSchema.annotate({ description: 'The id of a page on the shelf.' }),
      version: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'A version the shelf keeps of `page`; the current one when omitted.',
      }),
      scale: Schema.optional(Schema.Literals(VIDEO_SCALES)).annotate({ description: 'Pixels per declared pixel, 1 by default.' }),
    }),
    answer: arms({
      exporting: { page: Schema.String, video: videoSchema },
      exported: { page: Schema.String, video: videoSchema, path: Schema.String },
    }),
    refusals: ['artifact-unknown', 'no-timeline', 'disk-full', ...FILM_REFUSALS],
    effect: 'write',
    identity: { key: 'request' },
    subjects: () => [],
    confirmation: (input) => ({ summary: `Export page ${input.page} as a video?` }),
    confirmLabel: 'Export video',
    presentation: { running: 'Exporting the page as a video', done: 'Exported the page as a video' },
  }),
  cancel_artifact_video: operation('cancel_artifact_video', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    tool: { capability: 'artifacts' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    meaning: 'Stop a video export that is queued or drawing, closing what it opened and leaving no file.',
    grammar: 'Name the job export_artifact_video answered. A job that already finished or failed refuses `video-unknown`.',
    input: Schema.Struct({ job: VIDEO_JOB.annotate({ description: 'The job export_artifact_video answered.' }) }),
    answer: arms({ cancelled: { job: Schema.String } }),
    refusals: ['video-unknown'],
    effect: 'write',
    identity: { key: 'request' },
    subjects: () => [],
    confirmation: (input) => ({ summary: `Stop video export ${input.job}?` }),
    confirmLabel: 'Stop export',
    presentation: { running: 'Stopping a video export', done: 'Stopped a video export' },
  }),
};

export type ArtifactOperationId = keyof typeof ARTIFACT_OPERATIONS;

export type ArtifactsAnswer = DeclaredAnswer<(typeof ARTIFACT_OPERATIONS)['list_artifacts']['answer']>;
