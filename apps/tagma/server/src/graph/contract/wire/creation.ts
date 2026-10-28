import { Schema } from 'effect';
import { body, fieldsField, tagsField, title } from './fields.js';
import { edgeNameSchema } from './edges.js';
import { sourceInputSchema } from './sources.js';
import { contractIdSchema } from './tags/behaviour.js';
import { STORAGE_MODES } from '../../../projects/contract/wire/project.js';

export const creationFields = <Ref extends Schema.Top, Target extends Schema.Top>(reference: Ref, target: Target) => ({
  title,
  claim: Schema.optional(Schema.Boolean),
  body: Schema.optional(body).annotate({ description: 'Markdown.' }),
  parentId: Schema.optional(reference),
  contract: Schema.optional(contractIdSchema).annotate({
    description:
      'Required behaviour. Without tags, selects the creation type from installed catalog profiles; explicit tags must support it.',
  }),
  tags: Schema.optional(tagsField).annotate({ description: 'What the node is: a tag this project declares. None makes a titled note.' }),
  fields: Schema.optional(fieldsField).annotate({
    description: 'The values those tags declare, checked against each declaration. An operation-owned field is its operation’s to write.',
  }),
  edges: Schema.optional(Schema.Array(Schema.Struct({ kind: edgeNameSchema, to: target }))).annotate({
    description:
      'Outgoing relations born with the node: relates or discovered-from, which every block carries, or a kind its tags declare; a target in another project is linked into its graph.',
  }),
  amendsId: Schema.optional(reference).annotate({
    description: 'The block an amendment is about; it is born under it, with the amends edge.',
  }),
  sources: Schema.optional(Schema.Array(sourceInputSchema)).annotate({
    description: 'Anchors attached at creation. Exact sources on the direct parent transfer atomically to the child.',
  }),
  storage: Schema.optional(Schema.Literals(STORAGE_MODES)).annotate({
    description:
      "Where the block is kept: team rides the repository in .tagma, stealth stays in Tagma's data directory beside it. Absent, the parent's; under a stealth block, stealth.",
  }),
});

export const blockCreateSchema = Schema.Struct({
  ...creationFields(Schema.Int.check(Schema.isGreaterThan(0)), Schema.Int.check(Schema.isGreaterThan(0))),
  projectId: Schema.Int.check(Schema.isGreaterThan(0)),
  uuid: Schema.optional(Schema.String),
});

export type BlockCreate = typeof blockCreateSchema.Type;
