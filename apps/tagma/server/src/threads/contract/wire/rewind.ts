import { Schema } from 'effect';
import { family } from '@runlith/paging';
import { threadQueuedTurnSchema } from '@runlith/agent/protocol/http';
import { LinesReverted, RunFilesRead } from '../../../change-record/contract/wire/runFiles.js';
import { unreadGraphSchema } from './evidence.js';

export const REWIND_FILES = family('rewind_files', 1, 'json', { text: 420, json: 640 }, 20, () => ({
  path: 'x'.repeat(60),
  own: { added: 120, removed: 40 },
  committed: [
    {
      id: '01a0cab9-6847-7602-bed6-3503d2788ccf',
      runId: '01a0cad5-20dd-7ab7-bb04-f7885cb4586c',
      firstLine: 12,
      lines: 30,
      commit: 'a'.repeat(40),
    },
  ],
  held: [{ threadId: '01a0cab9-6847-7602-bed6-3503d2788ccf', agentName: 'x'.repeat(24), lines: { added: 3, removed: 1 } }],
  overwritten: ['01a0cab9-6847-7602-bed6-3503d2788ccf'],
  unproven: [],
  atHead: [],
}));

export const rewindScopeSchema = Schema.Literals(['from', 'turn']);

const rewindAttachmentsSchema = Schema.Array(
  Schema.Struct({ mime: Schema.String, url: Schema.String, filename: Schema.optional(Schema.String) }),
);

export const rewindDraftSchema = Schema.Struct({
  text: Schema.String,
  attachments: Schema.optional(rewindAttachmentsSchema),
});

export const rewindDraftsSchema = Schema.Array(
  Schema.Struct({ id: Schema.String, text: Schema.String, attachments: Schema.optional(rewindAttachmentsSchema) }),
);

export const rewindBlockedSchema = Schema.Literals(['rewind-summarized', 'rewind-rewound', 'rewind-unknown']);

export const rewindPointSchema = Schema.Union([
  Schema.Struct({ runId: Schema.String, rewindable: Schema.Literal(true) }),
  Schema.Struct({ runId: Schema.String, rewindable: Schema.Literal(false), reason: rewindBlockedSchema }),
]);

export const rewindStandingSchema = Schema.Struct({
  rewindId: Schema.String,
  scope: rewindScopeSchema,
  runIds: Schema.Array(Schema.String),
  restorable: Schema.Boolean,
});

export const rewindPointsFields = {
  points: Schema.Array(rewindPointSchema),
  rewinds: Schema.Array(rewindStandingSchema),
};

export const rewindChildSchema = Schema.Struct({
  threadId: Schema.String,
  name: Schema.NullOr(Schema.String),
  running: Schema.Boolean,
});

export const rewindPreviewSchema = Schema.Struct({
  at: Schema.String,
  scope: rewindScopeSchema,
  runIds: Schema.Array(Schema.String),
  turns: Schema.Int,
  draft: Schema.NullOr(rewindDraftSchema),
  running: Schema.NullOr(Schema.String),
  taken: Schema.Array(threadQueuedTurnSchema),
  children: Schema.Array(rewindChildSchema),
  rewriteTokens: Schema.Int,
});

export const rewindActSchema = Schema.Struct({
  op: Schema.String,
  block: Schema.NullOr(Schema.String),
  at: Schema.String,
});

export const rewindActsSchema = Schema.Struct({
  acts: Schema.Array(rewindActSchema),
  bounded: Schema.Boolean,
  unread: Schema.Array(unreadGraphSchema),
});

export const rewindFilesSchema = RunFilesRead;

export const rewindRevertedSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('reverted'), result: LinesReverted }),
  Schema.Struct({ status: Schema.Literal('refused'), code: Schema.String, reason: Schema.String }),
]);
