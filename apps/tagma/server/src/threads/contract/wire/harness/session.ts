import { Effect, Schema } from 'effect';
import { ProcessWitness } from '@runlith/executions/protocol/evidence';
import type { HarnessQuestionOption } from '@runlith/tagma/adapter/harness';
import { EnvironmentBinding } from '../../../../workspace/contract/wire/environments.js';
import { HARNESS_HOOK_BYTES } from './observation.js';
import { TerminalRefused } from '../../../../executions/contract/wire/refusals.js';

export const HARNESS_STORAGE_VARIABLES = [
  'HOME',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'GROK_HOME',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'PATH',
] as const;

export const harnessStorageSchema = Schema.Struct({
  binding: EnvironmentBinding,
  unreadable: Schema.optional(Schema.Literal('launch-storage-limit')),
  entries: Schema.Array(
    Schema.Struct({
      name: Schema.Literals(HARNESS_STORAGE_VARIABLES),
      value: Schema.String.check(Schema.isMaxLength(HARNESS_HOOK_BYTES)),
    }),
  ),
});
export type HarnessStorage = typeof harnessStorageSchema.Type;

export const harnessSessionSchema = Schema.Struct({
  account: Schema.optional(Schema.Struct({ provider: Schema.String, key: Schema.String })),
  storage: Schema.optional(harnessStorageSchema),
  exportPath: Schema.optional(Schema.String),
  prepared: Schema.optional(Schema.Struct({ id: Schema.String, artifact: Schema.String })),
  transcriptPath: Schema.optional(Schema.String),
  id: Schema.String,
  origin: Schema.Literals(['launched', 'adopted']),
  job: Schema.optional(ProcessWitness),
  state: Schema.Literals(['starting', 'running', 'stopping', 'uncertain', 'ended']),
  endedReason: Schema.optional(Schema.Literal('identity-unproven')),
  failure: Schema.optional(Schema.String),
  prompt: Schema.String,
  cwd: Schema.NullOr(Schema.String),
  argv: Schema.NullOr(Schema.Array(Schema.String)),
  ownerId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  startedAt: Schema.String,
  heartbeatAt: Schema.optional(Schema.String),
  seed: Schema.optional(Schema.Literal(true)),
  cut: Schema.optional(
    Schema.Struct({
      root: Schema.String,
      into: Schema.String,
      at: Schema.NullOr(Schema.String),
      own: Schema.Boolean,
      rows: Schema.Literals(['copied', 'unaddressed']),
    }),
  ),
});
export type HarnessProcessOutcome = 'completed' | 'failed' | 'aborted';
export type HarnessSession = typeof harnessSessionSchema.Type;

export const ALLOW_ONCE = 'allow-once';
export const DENY = 'deny';

export const PERMISSION_OPTIONS: readonly HarnessQuestionOption[] = [
  { value: ALLOW_ONCE, label: 'Allow once' },
  { value: DENY, label: 'Deny' },
];

export function harnessSessionActive(
  session: HarnessSession | null | undefined,
): session is HarnessSession & { readonly state: Exclude<HarnessSession['state'], 'ended'> } {
  return session !== null && session !== undefined && session.state !== 'ended';
}
