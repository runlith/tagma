import { PageCursor } from '@runlith/paging';
import { Schema } from 'effect';
import { arms } from '../../../platform/contract/wire/operation.js';
import { handle } from '@runlith/utils/printed';
import { BlockName } from './references.js';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';
import { startPriceSchema } from '../../../platform/contract/wire/start.js';
import { nodeActionsSchema } from './tags/actions.js';
import { PAGE_ROLES, SCREEN_ROWS } from './tags/pageRole.js';
import { graphAddressSchema } from './far.js';

export const graphCopySchema = Schema.Struct({
  projectId: Schema.Int,
  checkout: Schema.String,
  tree: Schema.String,
  branch: Schema.optional(Schema.NullOr(Schema.String)),
});
export type GraphCopy = typeof graphCopySchema.Type;

export const graphRemainderSchema = Schema.Struct({
  reason: Schema.Literal('commit-off'),
  checkout: Schema.NonEmptyString,
  files: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type GraphRemainder = typeof graphRemainderSchema.Type;

const unreachableProjectSchema = Schema.Struct({ projectId: Schema.Int, error: refusalSchema });
export type UnreachableProject = typeof unreachableProjectSchema.Type;

export const copyFailureSchema = Schema.Struct({ copy: graphCopySchema, error: refusalSchema });
export type CopyFailure = typeof copyFailureSchema.Type;

export const graphReportFields = {
  graphCopy: Schema.optional(graphCopySchema),
  copyFailures: Schema.optional(Schema.Array(copyFailureSchema)),
  unreachable: Schema.optional(Schema.Array(unreachableProjectSchema)).annotate({
    description: 'Typed failures of the projects this lookup attempted.',
  }),
};

export type GraphReport = Schema.Struct.Type<typeof graphReportFields>;

export const graphArms = <const Arms extends Record<string, Schema.Struct.Fields>>(declared: Arms) =>
  arms(
    Object.fromEntries(Object.entries(declared).map(([status, fields]) => [status, { ...fields, ...graphReportFields }])) as {
      readonly [K in keyof Arms]: Arms[K] & typeof graphReportFields;
    },
  );

export const blockAnswerSchema = Schema.Struct({
  name: BlockName,
  tags: Schema.Array(Schema.String),
  fields: Schema.Record(Schema.String, Schema.Unknown),
  actions: nodeActionsSchema,
  title: Schema.String,
  parentName: Schema.NullOr(BlockName),
  superseded: Schema.Boolean,
  blocked: Schema.Boolean,
  stealth: Schema.optional(Schema.Literal(true)).annotate({
    description: "Kept in stealth storage: Tagma's data directory, never the repository.",
  }),
  updatedAt: Schema.String,
});
export type BlockAnswer = typeof blockAnswerSchema.Type;

export const callJournalRangeSchema = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
  chars: Schema.optional(Schema.Struct({ from: Schema.Number, to: Schema.Number })),
});

export const remainingDebtSchema = Schema.Struct({
  rule: BlockName,
  title: Schema.String,
  entries: Schema.Int,
  reassign: Schema.String,
});
export type RemainingDebt = typeof remainingDebtSchema.Type;

export const idleSpecSchema = Schema.Struct({ name: BlockName, title: Schema.String });
export type IdleSpecAnswer = typeof idleSpecSchema.Type;

export const movedSchema = Schema.Struct({
  blocks: Schema.Int,
  from: Schema.String,
  relinked: Schema.Int.annotate({ description: 'Edges of other projects of this machine now addressed at the new graph.' }),
  dropped: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: 'Module relations across the edge of the moved subtree: a module map names modules of its own project alone.',
  }),
  left: Schema.optional(
    Schema.Array(Schema.Struct({ project: Schema.String, edges: Schema.optional(Schema.Int), reason: Schema.String })),
  ).annotate({ description: 'Projects whose edges into the moved blocks still address the old graph, and why.' }),
}).annotate({ description: 'What a move into the graph of another project carried with the block.' });
export type Moved = typeof movedSchema.Type;

export const crowdedSchema = Schema.Struct({
  parent: BlockName,
  title: Schema.String,
  role: Schema.Literals(PAGE_ROLES),
  children: Schema.Int,
}).annotate({
  description: `A page this write left with more than ${SCREEN_ROWS} standing children of one role: group them by subject under it in this same work.`,
});
export type Crowded = typeof crowdedSchema.Type;

export const blockResultFields = {
  ...graphReportFields,
  block: blockAnswerSchema,
  moved: Schema.optional(movedSchema),
  crowded: Schema.optional(crowdedSchema),
  refsIn: Schema.optional(Schema.Array(BlockName)),
  debt: Schema.optional(Schema.Array(remainingDebtSchema)),
  debtUnreadable: Schema.optional(Schema.Array(Schema.String)),
  warning: Schema.optional(Schema.String),
  specs: Schema.optional(Schema.Array(idleSpecSchema)),
  journal: Schema.optional(callJournalRangeSchema),
  journalUnreadable: Schema.optional(Schema.String),
  start: Schema.optional(startPriceSchema),
};
export type BlockResultAnswer = Schema.Struct.Type<typeof blockResultFields> & { readonly status: 'ok' };

export const overviewFields = { overview: Schema.String };

export const listingFacts = {
  total: Schema.Number,
  shown: Schema.Number,
  next: Schema.NullOr(PageCursor),
  complete: Schema.Boolean,
};

export const JournalPosition = Schema.Number.annotate(handle());

export const eventRowSchema = Schema.Struct({
  id: JournalPosition,
  at: Schema.String,
  op: Schema.String,
  blockName: Schema.NullOr(BlockName),
  destination: Schema.optional(graphAddressSchema),
  writer: Schema.NullOr(Schema.String),
});
export type EventRow = typeof eventRowSchema.Type;
