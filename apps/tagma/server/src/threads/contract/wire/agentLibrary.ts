import { Schema } from 'effect';
import { sectionEditSchema, type SectionEdit } from '@runlith/agent/thread/agents/AgentProfile';
import { instructionSetSchema } from '../../../graph/contract/wire/instructions.js';
import { startCostSchema } from '../../../platform/contract/wire/start.js';

export const agentModelSchema = Schema.Struct({
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  reasoning: Schema.optional(Schema.NullOr(Schema.String)),
});

export const agentFrontmatterSchema = Schema.Struct({
  description: Schema.optional(Schema.String),
  extends: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  capabilities: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  tools: Schema.optional(Schema.Array(Schema.String)),
  model: Schema.optional(agentModelSchema),
  sections: Schema.optional(Schema.Array(sectionEditSchema)),
});
export type AgentFrontmatter = typeof agentFrontmatterSchema.Type;

export const agentFileScopeSchema = Schema.Literals(['project', 'personal']);
export type AgentFileScope = typeof agentFileScopeSchema.Type;
export const agentOriginSchema = Schema.Struct({
  scope: Schema.Literals(['builtin', 'project', 'personal', 'app', 'plugin', 'thread']),
  path: Schema.NullOr(Schema.String),
  revision: Schema.NullOr(Schema.String),
});
export const agentDefinitionHeaderSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  origin: agentOriginSchema,
  config: agentFrontmatterSchema,
  editable: Schema.Boolean,
});
export const agentDefinitionSchema = Schema.Struct({
  ...agentDefinitionHeaderSchema.fields,
  body: Schema.String,
  source: Schema.String,
});
export type AgentDefinition = typeof agentDefinitionSchema.Type;

export const promptSectionSchema = Schema.Struct({ id: Schema.String, title: Schema.String, source: Schema.String, text: Schema.String });
export type PromptSection = typeof promptSectionSchema.Type;
export const promptDocumentSchema = Schema.Struct({ text: Schema.String, sections: Schema.Array(promptSectionSchema) });
export type PromptDocument = typeof promptDocumentSchema.Type;

export const agentCapabilitySchema = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  tools: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
  runtimeSources: Schema.Array(Schema.String),
});
export const agentCatalogSchema = Schema.Struct({
  definitions: Schema.Array(agentDefinitionHeaderSchema),
  rejected: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
  floors: Schema.Struct({ project: Schema.String, personal: Schema.String }),
  capabilities: Schema.Array(agentCapabilitySchema),
});
export type AgentCatalog = typeof agentCatalogSchema.Type;

export const agentPreviewInputSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
});
export const agentToolCatalogSchema = Schema.Struct({
  basis: Schema.Literal('definition'),
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      exposure: Schema.Literals(['eager', 'deferred']),
      schemaChars: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
  atBirth: Schema.Array(Schema.Struct({ source: Schema.String, names: Schema.Array(Schema.String) })),
});
export type AgentToolCatalog = typeof agentToolCatalogSchema.Type;

export const agentPreviewSchema = Schema.Struct({
  definition: agentDefinitionSchema,
  prompt: promptDocumentSchema,
  toolCatalog: Schema.NullOr(agentToolCatalogSchema),
  start: Schema.NullOr(startCostSchema),
  instructions: Schema.NullOr(instructionSetSchema),
  instructionBasis: Schema.Literals(['current', 'delivered', 'unavailable']),
  capabilities: Schema.Array(Schema.String),
  context: Schema.Struct({
    project: Schema.String,
    world: Schema.NullOr(Schema.Struct({ root: Schema.String, platform: Schema.String, shell: Schema.String })),
  }),
  frozen: Schema.Boolean,
  notes: Schema.Array(Schema.String),
});
export type AgentPreview = typeof agentPreviewSchema.Type;
export type AgentPreviewInput = typeof agentPreviewInputSchema.Type;

export const agentNameSchema = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[^/\\\u0000-\u001f]+$/u));
export const agentSaveSchema = Schema.Struct({
  name: agentNameSchema,
  scope: agentFileScopeSchema,
  source: Schema.String.check(Schema.isMinLength(1)),
  revision: Schema.NullOr(Schema.String),
});
export type AgentSave = typeof agentSaveSchema.Type;

export const agentSkillAimSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('thread'), id: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('draft'), type: Schema.optional(Schema.String) }),
]).pipe(Schema.toTaggedUnion('kind'));
export type AgentSkillAim = typeof agentSkillAimSchema.Type;

export const agentSkillCatalogSchema = Schema.Struct({
  skills: Schema.Array(Schema.Struct({ id: Schema.String, description: Schema.String })),
  basis: Schema.Literals(['thread', 'next-turn']),
  available: Schema.Boolean,
  note: Schema.NullOr(Schema.String),
});
export type AgentSkillCatalog = typeof agentSkillCatalogSchema.Type;

export type AgentFile = {
  readonly id: string;
  readonly description: string;
  readonly extends: string | undefined;
  readonly capabilities: readonly string[] | undefined;
  readonly tools: readonly string[] | undefined;
  readonly model: AgentFrontmatter['model'];
  readonly sections: readonly SectionEdit[] | undefined;
  readonly body: string;
  readonly path: string;
  readonly directory: string;
  readonly origin: AgentFileOrigin;
  readonly revision: string;
  readonly source: string;
};

export type AgentFileOrigin = AgentFileScope | 'app' | 'plugin';

export type AgentFloor = { readonly directory: string; readonly origin: AgentFileScope };

export type AgentFileDiscovery = {
  readonly agents: readonly AgentFile[];
  readonly rejected: readonly { readonly path: string; readonly reason: string }[];
};
