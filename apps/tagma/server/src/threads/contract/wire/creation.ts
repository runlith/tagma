import { Schema } from 'effect';
import { AgentApprovalMode } from '@runlith/agent/contracts';
import { TeamLayer } from '@runlith/agent/collaboration/team';
import { NAME_PROVENANCES } from '../../../thread-record/contract/wire/name.js';
import { placeRole } from '../../../platform/contract/wire/place.js';
import { blockMention } from '../../../graph/contract/wire/fields.js';

const threadBirthFields = {
  title: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  nameOrigin: Schema.optional(Schema.Literals(NAME_PROVENANCES)),
  type: Schema.optional(Schema.String),
  host: Schema.optional(
    Schema.Struct({ kind: Schema.String.check(Schema.isMinLength(1)), id: Schema.String.check(Schema.isMinLength(1)) }),
  ),
  scopeName: Schema.optional(Schema.String),
  account: Schema.optional(Schema.String),
  switches: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  bindings: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  approvalMode: Schema.optional(AgentApprovalMode),
  delegation: Schema.optional(Schema.Boolean),
  team: Schema.optional(TeamLayer).annotate({
    description: 'The thread’s own copy of the sub-agent team, as set_thread_team takes it; absent, it follows the project.',
  }),
};

export const threadCreateSchema = Schema.Union([
  Schema.Struct({
    ...threadBirthFields,
    parent: Schema.optional(Schema.Never),
    task: Schema.optional(Schema.String),
    work: Schema.optional(blockMention).annotate({
      description: 'A block of work the new thread takes in its own name at birth and opens its first turn on.',
    }),
    worktree: Schema.optional(Schema.String.check(Schema.isMinLength(1)).annotate(placeRole('value'))),
    base: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
    worktreeName: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  }),
  Schema.Struct({
    ...threadBirthFields,
    parent: Schema.String.check(Schema.isMinLength(1)),
    task: Schema.String,
    work: Schema.optional(Schema.Never),
    worktree: Schema.optional(Schema.Never),
    base: Schema.optional(Schema.Never),
    worktreeName: Schema.optional(Schema.Never),
    title: Schema.optional(Schema.Never),
    scopeName: Schema.optional(Schema.Never),
    account: Schema.optional(Schema.Never),
    switches: Schema.optional(Schema.Never),
    approvalMode: Schema.optional(Schema.Never),
    delegation: Schema.optional(Schema.Never),
    team: Schema.optional(Schema.Never),
  }),
]);

export const threadTitleSchema = Schema.Struct({ title: Schema.String });
export const threadSeenSchema = Schema.Struct({ runId: Schema.String });
