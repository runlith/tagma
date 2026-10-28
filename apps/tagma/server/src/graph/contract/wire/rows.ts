import { Schema } from 'effect';
import { SOURCE_KINDS } from './sources.js';
import { edgeNameSchema } from './edges.js';
import { fieldsField, tagsField } from './fields.js';
import { SERVES_FROM } from './storage.js';
import { STORAGE_MODES } from '../../../projects/contract/wire/project.js';
import { subtreeShapeSchema } from './standing.js';
import { blockListRowSchema, viewResultsSchema } from './reads.js';
import { graphReportFields, type GraphReport } from './answers.js';
import { nodeActionsSchema } from './tags/actions.js';
import { farEndSchema, type RefElsewhere, refElsewhereSchema } from './far.js';
import { BlockName } from './references.js';

export const projectSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  repoKey: Schema.String,
  rootPath: Schema.String,
  strictProvenance: Schema.Boolean,
  private: Schema.Boolean,
  global: Schema.Boolean,
  storage: Schema.Literals(STORAGE_MODES),
  graphRemote: Schema.NullOr(Schema.String),
  servesFrom: Schema.Literals(SERVES_FROM),
  createdAt: Schema.String,
});
export type Project = typeof projectSchema.Type;

export const projectBranchSchema = Schema.Struct({
  branch: Schema.String,
  worktree: Schema.NullOr(Schema.String),
  canonical: Schema.Boolean,
});
export type ProjectBranch = typeof projectBranchSchema.Type;

const treeBlockFields = {
  name: BlockName,
  projectId: Schema.Number,
  parentName: Schema.NullOr(BlockName),
  ord: Schema.Number,
  tags: tagsField,
  fields: fieldsField,
  actions: nodeActionsSchema,
  title: Schema.String,
  superseded: Schema.Boolean,
  blocked: Schema.Boolean,
  building: Schema.Boolean,
  answered: Schema.Boolean,
  stealth: Schema.optional(Schema.Literal(true)).annotate({
    description: "Kept in stealth storage: Tagma's data directory, never the repository.",
  }),
  displaced: Schema.optional(Schema.Literal(true)).annotate({
    description:
      'A stealth block whose team parent left the team tree: it stands under the root, and returns under that parent when it comes back.',
  }),
  deletedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
} as const;

const blockFields = treeBlockFields;

export const blockSchema = Schema.Struct({ ...blockFields, body: Schema.String });
export type Block = typeof blockSchema.Type;

export const writtenBlockSchema = Schema.Struct({
  ...blockFields,
  body: Schema.String,
  refsIn: Schema.optional(Schema.Array(BlockName)),
});
export type WrittenBlock = typeof writtenBlockSchema.Type;

export const treeBlockSchema = Schema.Struct(treeBlockFields);
export type TreeBlock = typeof treeBlockSchema.Type;

export type ListedBlock = TreeBlock | typeof blockListRowSchema.Type;

export const edgeSchema = Schema.Struct({
  fromName: BlockName,
  toName: BlockName,
  kind: edgeNameSchema,
  createdBySessionId: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
  graph: Schema.optional(farEndSchema).annotate({
    description: 'The project of the far end, when it stands in another graph; absent for an edge within the graph.',
  }),
});
export type Edge = typeof edgeSchema.Type;

export const refSchema = Schema.Struct({ fromName: BlockName, toName: BlockName });
export type Ref = typeof refSchema.Type;

export const sourceSchema = Schema.Struct({
  id: Schema.Number,
  kind: Schema.Literals(SOURCE_KINDS),
  ref: Schema.String,
  symbol: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type Source = typeof sourceSchema.Type;

export const writerSchema = Schema.NullOr(Schema.Struct({ id: Schema.Number, harness: Schema.String, key: Schema.String }));

export const proposalVerdictSchema = Schema.Struct({
  status: Schema.String,
  writer: writerSchema,
  reason: Schema.NullOr(Schema.String),
  by: Schema.Array(Schema.String),
  at: Schema.String,
  unreadable: Schema.optional(Schema.String),
});
export type ProposalVerdict = typeof proposalVerdictSchema.Type;

export interface BlockRead extends Block, GraphReport {
  readonly edgesOut: readonly Edge[];
  readonly edgesIn: readonly Edge[];
  readonly edgesInUnread?: readonly string[] | undefined;
  readonly refsOut: readonly string[];
  readonly refsElsewhere?: readonly RefElsewhere[] | undefined;
  readonly refsAbsent?: readonly string[] | undefined;
  readonly refsIn: readonly string[];
  readonly restingIn: { readonly edges: readonly Edge[]; readonly refs: readonly string[] };
  readonly sources: readonly Source[];
  readonly reach: string | null;
  readonly verdict: ProposalVerdict | null;
  readonly ending: BlockEndingBody | null;
  readonly author: number | null;
  readonly answeredBy: string | null;
  readonly answeredCommit: string | null;
  readonly answeredCheck: AnsweredCheck | null;
  readonly results: typeof viewResultsSchema.Type | null;
  readonly shape: typeof subtreeShapeSchema.Type;
  readonly children: readonly BlockRead[];
}

export const answeredCheckSchema = Schema.Struct({ finding: Schema.String, head: Schema.NullOr(Schema.String) });
export type AnsweredCheck = typeof answeredCheckSchema.Type;

export const blockEndingSchema = Schema.Struct({
  status: Schema.String,
  writer: writerSchema,
  reason: Schema.NullOr(Schema.String),
  at: Schema.String,
  commit: Schema.optional(Schema.NullOr(Schema.String)),
  unreadable: Schema.optional(Schema.String),
});
export type BlockEndingBody = typeof blockEndingSchema.Type;

export const blockReadSchema: Schema.Codec<BlockRead> = Schema.Struct({
  ...graphReportFields,
  ...blockFields,
  body: Schema.String,
  edgesOut: Schema.Array(edgeSchema),
  edgesIn: Schema.Array(edgeSchema),
  edgesInUnread: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: 'Projects of this machine whose edges into this block could not be read yet: edgesIn may lack theirs.',
  }),
  refsOut: Schema.Array(BlockName),
  refsElsewhere: Schema.optional(Schema.Array(refElsewhereSchema)).annotate({
    description: 'The references of refsOut that stand in another project of this machine, with that project.',
  }),
  refsAbsent: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: 'Names written in the body that no copy of this machine holds.',
  }),
  refsIn: Schema.Array(BlockName),
  restingIn: Schema.Struct({ edges: Schema.Array(edgeSchema), refs: Schema.Array(BlockName) }),
  sources: Schema.Array(sourceSchema),
  reach: Schema.NullOr(Schema.String),
  verdict: Schema.NullOr(proposalVerdictSchema),
  ending: Schema.NullOr(blockEndingSchema),
  author: Schema.NullOr(Schema.Number),
  answeredBy: Schema.NullOr(Schema.String),
  answeredCommit: Schema.NullOr(Schema.String),
  answeredCheck: Schema.NullOr(answeredCheckSchema),
  results: Schema.NullOr(viewResultsSchema),
  shape: subtreeShapeSchema,
  children: Schema.Array(Schema.suspend((): Schema.Codec<BlockRead> => blockReadSchema)),
});
