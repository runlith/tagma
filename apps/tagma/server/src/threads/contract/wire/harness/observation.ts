import { Effect, Schema } from 'effect';
import { HARNESS_DETAIL_MAX, HARNESS_ID_MAX, harnessClaimSchema, harnessModelReportSchema } from '@runlith/tagma/adapter/harness';
import { harnessNameSchema, harnessTransportSchema } from './names.js';
import { harnessSaidSchema } from './said.js';

export const harnessExecutionSchema = Schema.Struct({
  execution: Schema.String,
  incarnation: Schema.Int,
});
export type HarnessExecutionRef = typeof harnessExecutionSchema.Type;

export const harnessBindingSchema = Schema.Struct({
  sessionId: Schema.NullOr(Schema.String),
  execution: Schema.NullOr(harnessExecutionSchema),
  rootKey: Schema.NullOr(Schema.String),
  workKey: Schema.optional(Schema.String),
});
export type HarnessBinding = typeof harnessBindingSchema.Type;

export const harnessProvenanceSchema = Schema.Literals(['hook', 'vendor-record', 'transcript', 'session-store', 'terminal', 'protocol']);
export type HarnessProvenance = typeof harnessProvenanceSchema.Type;

export const harnessScopeSchema = Schema.Struct({
  rootKey: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
});
export type HarnessScope = typeof harnessScopeSchema.Type;

export const harnessStaleSchema = Schema.Literals(['unproven-source', 'refused-evidence', 'authority-lapsed', 'refresh-failed']);
export type HarnessStale = typeof harnessStaleSchema.Type;

export const harnessLastKnownSchema = Schema.Struct({
  value: Schema.String,
  claim: Schema.NullOr(harnessClaimSchema),
  source: Schema.NullOr(harnessProvenanceSchema),
  scope: Schema.NullOr(harnessScopeSchema),
  observedAt: Schema.NullOr(Schema.String),
  why: harnessStaleSchema,
});
export type HarnessLastKnown = typeof harnessLastKnownSchema.Type;

export const harnessFieldSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('NotRead') }),
  Schema.Struct({
    _tag: Schema.Literal('Value'),
    value: Schema.String,
    claim: harnessClaimSchema,
    source: harnessProvenanceSchema,
    scope: harnessScopeSchema,
    observedAt: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal('Absent'),
    source: harnessProvenanceSchema,
    scope: harnessScopeSchema,
    observedAt: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal('Unsupported'),
    source: harnessProvenanceSchema,
    scope: harnessScopeSchema,
    observedAt: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal('Unreadable'),
    source: harnessProvenanceSchema,
    scope: harnessScopeSchema,
    observedAt: Schema.String,
    reason: Schema.String,
    lastKnown: Schema.NullOr(harnessLastKnownSchema),
  }),
  Schema.Struct({ _tag: Schema.Literal('Stale'), lastKnown: harnessLastKnownSchema }),
]);
export type HarnessField = typeof harnessFieldSchema.Type;

export const harnessMetadataSchema = Schema.Struct({
  model: harnessFieldSchema,
  effort: harnessFieldSchema,
  title: harnessFieldSchema,
});
export type HarnessFields = typeof harnessMetadataSchema.Type;

export const harnessDiagnosticSchema = Schema.Struct({
  cause: Schema.Literals([
    'session-ended',
    'session-stopping',
    'turn-mismatch',
    'stale-execution',
    'execution-unproven',
    'root-unproven',
    'work-unproven',
    'foreign-root',
    'stale-revision',
    'stale-evidence',
    'child-event',
    'question-standing',
    'answer-unread',
    'submit-unconfirmed',
    'cli-background',
    'words-unproven',
    'words-dropped',
    'history-seeded',
  ]),
  at: Schema.String,
  detail: Schema.String,
});
export type HarnessDiagnostic = typeof harnessDiagnosticSchema.Type;

export const HARNESS_DIAGNOSTIC_LIMIT = 8;

export const HARNESS_HELD_LIMIT = 8;
export const HARNESS_SEEN_LIMIT = 8;

export const harnessReceiptSchema = Schema.Struct({
  outcome: Schema.Literals(['admitted', 'kept', 'refused', 'duplicate', 'unchanged']),
  revision: Schema.Int,
  cause: Schema.NullOr(harnessDiagnosticSchema.fields.cause),
  harness: harnessNameSchema,
  transport: harnessTransportSchema,
  seeded: Schema.optional(Schema.Literal(true)),
});
export type HarnessReceipt = typeof harnessReceiptSchema.Type;

export const HARNESS_HOOK_BYTES = 32 * 1024;

const reportId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(HARNESS_ID_MAX));
export const HARNESS_CALL_OUTPUT_MAX = 8 * 1024;
export const harnessCallReportSchema = Schema.Struct({
  id: reportId,
  tool: reportId,
  done: Schema.optional(Schema.Boolean),
  subject: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
  output: Schema.optional(Schema.String.check(Schema.isMaxLength(HARNESS_CALL_OUTPUT_MAX))),
  failed: Schema.optional(Schema.Boolean),
});
export type HarnessCallReport = typeof harnessCallReportSchema.Type;
const hookText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(HARNESS_HOOK_BYTES));
const harnessShellSchema = Schema.Struct({ command: Schema.String.check(Schema.isMinLength(1)), cwd: hookText });
export type HarnessShell = typeof harnessShellSchema.Type;
export const harnessHookSchema = Schema.Struct({
  hook_event_name: Schema.optional(reportId),
  hookEventName: Schema.optional(reportId),
  session_id: Schema.optional(reportId),
  sessionId: Schema.optional(reportId),
  turn_id: Schema.optional(reportId),
  prompt_id: Schema.optional(reportId),
  generation_id: Schema.optional(reportId),
  tool_name: Schema.optional(reportId),
  toolName: Schema.optional(reportId),
  tool_use_id: Schema.optional(reportId),
  command: Schema.optional(reportId),
  agent_id: Schema.optional(reportId),
  status: Schema.optional(reportId),
  source: Schema.optional(reportId),
  notification_type: Schema.optional(reportId),
  notificationType: Schema.optional(reportId),
  transcript_path: Schema.optional(Schema.String.check(Schema.isMaxLength(HARNESS_HOOK_BYTES))),
  error: Schema.optional(Schema.String.check(Schema.isMaxLength(HARNESS_DETAIL_MAX))),
  model: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(HARNESS_ID_MAX)))),
});
export type HarnessHookInput = typeof harnessHookSchema.Type;
export const harnessReportSchema = Schema.Struct({
  sessionKey: Schema.optional(reportId),
  model: Schema.optional(harnessModelReportSchema),
  session: Schema.optional(reportId),
  turn: Schema.optional(reportId),
  receipt: Schema.optional(reportId),
  occasion: Schema.optional(Schema.Literals(['session-start', 'self-description', 'turn-start', 'activity', 'wait', 'turn-end'])),
  capturedAt: Schema.optional(reportId),
  inputs: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(HARNESS_HOOK_BYTES)))),
  event: Schema.optional(harnessHookSchema),
  prompt: Schema.optional(Schema.String),
  call: Schema.optional(harnessCallReportSchema),
  shell: Schema.optional(harnessShellSchema),
  diagnostics: Schema.optional(Schema.Array(harnessCallReportSchema)),
  said: Schema.optional(harnessSaidSchema),
});
export type HarnessReportInput = typeof harnessReportSchema.Type;

export const harnessObservationSchema = Schema.Struct({
  binding: harnessBindingSchema,
  revision: Schema.Int,
  metadata: harnessMetadataSchema,
  diagnostics: Schema.Array(harnessDiagnosticSchema),
  through: Schema.optional(Schema.String),
});
export type HarnessObservation = typeof harnessObservationSchema.Type;

export const harnessEventSchema = Schema.Struct({
  occasion: Schema.Literals(['session-start', 'self-description', 'turn-start', 'activity', 'wait', 'turn-end']),
  observedAt: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  rootKey: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
  receipt: Schema.NullOr(Schema.String),
  atRevision: Schema.NullOr(Schema.Int),
  model: harnessFieldSchema,
  childId: Schema.optional(Schema.String),
  transcriptPath: Schema.optional(Schema.String.check(Schema.isMaxLength(HARNESS_HOOK_BYTES))),
});
export type HarnessEvent = typeof harnessEventSchema.Type;

export const currentModel = (observation: HarnessObservation): string | null => {
  const field = observation.metadata.model;
  if (field._tag !== 'Value' || field.claim === 'last-recorded') return null;
  const bound = observation.binding.rootKey;
  if (bound === null || field.scope.rootKey !== bound) return null;
  return field.value;
};

export const currentEffort = (observation: HarnessObservation): string | null => {
  const field = observation.metadata.effort;
  if (field._tag !== 'Value' || field.claim === 'last-recorded') return null;
  const bound = observation.binding.rootKey;
  if (bound === null || field.scope.rootKey !== bound) return null;
  return field.value;
};

export const unmeasuredObservation = (): HarnessObservation => ({
  binding: { sessionId: null, execution: null, rootKey: null },
  revision: 0,
  metadata: { model: { _tag: 'NotRead' }, effort: { _tag: 'NotRead' }, title: { _tag: 'NotRead' } },
  diagnostics: [],
});
