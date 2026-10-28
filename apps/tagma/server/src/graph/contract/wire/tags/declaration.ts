import { Schema } from 'effect';
import { edgeNameSchema } from '../edges.js';
import { nameRef } from '../fields.js';
import { SOURCE_KINDS } from '../sources.js';
import { type Section, shippedSections, tagSectionsSchema } from './sections.js';
import { type ContractBindings, contractBindingsSchema } from './behaviour.js';
import { type CatalogProfile, catalogProfileSchema } from './profile.js';

export const ROLES = ['status', 'holder', 'work', 'spec', 'container', 'law', 'leaf', 'observation', 'enforcement', 'delivery'] as const;
export type Role = (typeof ROLES)[number];

export const SCALAR_FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'session'] as const;
export type ScalarFieldType = (typeof SCALAR_FIELD_TYPES)[number];

export const FIELD_SCHEMA_NAMES = [
  'line',
  'blockQuery',
  'viewLayout',
  'researchSource',
  'tagFields',
  'tagEdges',
  'tagSources',
  'tagGates',
  'tagRoles',
  'tagBody',
  'tagExtends',
  'tagOpen',
  'tagSections',
  'tagIdentity',
  'tagContracts',
  'keyedLayer',
  'typeFork',
  'guidanceFork',
  'catalogRelease',
  'catalogProfile',
  'lawEnforcement',
  'moduleEntries',
  'moduleOrder',
] as const;
export type FieldSchemaName = (typeof FIELD_SCHEMA_NAMES)[number];

export const fieldTypeSchema = Schema.Union([
  Schema.Literals(SCALAR_FIELD_TYPES),
  Schema.Struct({ type: Schema.Literal('enum'), values: Schema.NonEmptyArray(Schema.String) }),
  Schema.Struct({
    type: Schema.Literal('ref'),
    tag: Schema.optional(Schema.String),
    many: Schema.optional(Schema.Literal(true)),
  }),
  Schema.Struct({ type: Schema.Literal('schema'), name: Schema.Literals(FIELD_SCHEMA_NAMES) }),
]);
export type FieldType = typeof fieldTypeSchema.Type;

export const gateSchema = Schema.Union([
  Schema.Struct({
    gate: Schema.Literal('transition'),
    field: Schema.String,
    from: Schema.String,
    to: Schema.String,
  }),
  Schema.Struct({ gate: Schema.Literal('required'), field: Schema.String }),
  Schema.Struct({ gate: Schema.Literal('open-children'), tag: Schema.String }),
  Schema.Struct({ gate: Schema.Literal('source-required'), kinds: Schema.Array(Schema.Literals(SOURCE_KINDS)) }),
]);
export type Gate = typeof gateSchema.Type;

export const bodyShapeSchema = Schema.Struct({
  shape: Schema.Literals(['content', 'orientation']),
  cap: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type BodyShape = typeof bodyShapeSchema.Type;

export const tagFieldsSchema = Schema.Record(Schema.String, fieldTypeSchema);
export type TagFields = typeof tagFieldsSchema.Type;
export const edgeDeclarationSchema = Schema.Union([
  edgeNameSchema,
  Schema.Struct({ kind: edgeNameSchema, to: Schema.NonEmptyArray(Schema.NonEmptyString) }),
]);
export type EdgeDeclaration = typeof edgeDeclarationSchema.Type;
export const tagEdgesSchema = Schema.Array(edgeDeclarationSchema);
export type TagEdges = typeof tagEdgesSchema.Type;
export const edgeKindOf = (declared: EdgeDeclaration): string => (typeof declared === 'string' ? declared : declared.kind);
export const edgeTargetsOf = (declared: EdgeDeclaration): readonly string[] | null => (typeof declared === 'string' ? null : declared.to);
export const tagSourcesSchema = Schema.Array(Schema.Literals(SOURCE_KINDS));
export type TagSources = typeof tagSourcesSchema.Type;
export const tagGatesSchema = Schema.Array(gateSchema);
export const tagExtendsSchema = Schema.NonEmptyString;

export const SLOTS = ['edges', 'sources'] as const;
export type Slot = (typeof SLOTS)[number];
export const tagOpenSchema = Schema.Array(Schema.Literals(SLOTS));

export const statusBindingSchema = Schema.Struct({
  field: Schema.NonEmptyString,
  initial: Schema.NonEmptyString,
  claimed: Schema.optional(Schema.NonEmptyString),
  done: Schema.optional(Schema.NonEmptyString),
  closed: Schema.optional(Schema.NonEmptyString),
});
export type StatusBinding = typeof statusBindingSchema.Type;

const roleBindings = {
  status: Schema.optional(statusBindingSchema),
  holder: Schema.optional(Schema.NonEmptyString),
  work: Schema.optional(Schema.Literal(true)),
  spec: Schema.optional(Schema.Literal(true)),
  container: Schema.optional(Schema.Literal(true)),
  law: Schema.optional(Schema.NonEmptyString),
  leaf: Schema.optional(Schema.Literal(true)),
  observation: Schema.optional(Schema.Literal(true)),
  enforcement: Schema.optional(Schema.NonEmptyString),
  delivery: Schema.optional(Schema.NonEmptyString),
} as const satisfies { [R in Role]: unknown };

export const tagRolesSchema = Schema.Struct(roleBindings);
export type TagRoles = typeof tagRolesSchema.Type;

export const OWNED_ROLES = ['status', 'holder', 'law', 'enforcement', 'delivery'] as const;
export type OwnedRole = (typeof OWNED_ROLES)[number];

export const tagSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.optional(Schema.NonEmptyString),
  extends: Schema.optional(tagExtendsSchema),
  fields: tagFieldsSchema,
  edges: tagEdgesSchema,
  sources: Schema.optional(tagSourcesSchema),
  gates: tagGatesSchema,
  roles: tagRolesSchema,
  body: bodyShapeSchema,
  open: Schema.optional(tagOpenSchema),
  sections: Schema.optional(tagSectionsSchema),
  contracts: Schema.optional(contractBindingsSchema),
  prompt: Schema.String,
});
export type Tag = typeof tagSchema.Type;

export type Declaration = {
  readonly id: string;
  readonly extends?: string;
  readonly fields?: TagFields;
  readonly edges?: TagEdges;
  readonly sources?: TagSources;
  readonly gates?: readonly Gate[];
  readonly roles?: TagRoles;
  readonly body?: BodyShape;
  readonly open?: readonly Slot[];
  readonly sections?: readonly Section[];
  readonly contracts?: ContractBindings;
  readonly prompt: string;
};

export type Catalog = {
  readonly id: string;
  readonly guidance: string;
  readonly tags: readonly Tag[];
  readonly profile?: CatalogProfile;
};

export const sectioned = (tag: Tag): Tag => ({ ...tag, sections: shippedSections(tag.id, tag.prompt) });

export const upgradeBlockedSchema = Schema.Struct({ code: Schema.NonEmptyString, reason: Schema.String });
export type UpgradeBlocked = typeof upgradeBlockedSchema.Type;

export const catalogReleaseSchema = Schema.Struct({
  revision: Schema.String,
  guidance: Schema.String,
  tags: Schema.Array(tagSchema),
  profile: Schema.optional(catalogProfileSchema),
  blocked: Schema.optional(upgradeBlockedSchema),
});
export type CatalogRelease = typeof catalogReleaseSchema.Type;

export const catalogFieldsSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  tags: Schema.Array(nameRef),
  release: Schema.optional(catalogReleaseSchema),
});

export const installedCatalogSchema = Schema.Struct({
  name: Schema.String,
  id: Schema.String,
  guidance: Schema.String,
  tags: Schema.Array(Schema.String),
  release: Schema.optional(catalogReleaseSchema),
  profile: Schema.optional(catalogProfileSchema),
});
export type InstalledCatalog = typeof installedCatalogSchema.Type;

export const CATALOG_DECLARATION: Tag = {
  id: 'catalog',
  fields: {
    id: 'string',
    tags: { type: 'ref', tag: 'tag', many: true },
    release: { type: 'schema', name: 'catalogRelease' },
    profile: { type: 'schema', name: 'catalogProfile' },
    layer: { type: 'schema', name: 'keyedLayer' },
    fork: { type: 'schema', name: 'guidanceFork' },
  },
  edges: ['relates'],
  gates: [
    { gate: 'required', field: 'id' },
    { gate: 'required', field: 'tags' },
  ],
  roles: {},
  body: { shape: 'content' },
  prompt:
    "A #catalog declares a project vocabulary: its body gives the purpose, the shared workflow and how its tags relate, each concept's instructions staying in its tag; `tags` names the participating declarations, `release` is the installer's. Editing it changes this project only, not other projects or agent capabilities.",
};

export const TAG_DECLARATION: Tag = {
  id: 'tag',
  fields: {
    id: 'string',
    fields: { type: 'schema', name: 'tagFields' },
    edges: { type: 'schema', name: 'tagEdges' },
    sources: { type: 'schema', name: 'tagSources' },
    gates: { type: 'schema', name: 'tagGates' },
    roles: { type: 'schema', name: 'tagRoles' },
    body: { type: 'schema', name: 'tagBody' },
    extends: { type: 'schema', name: 'tagExtends' },
    open: { type: 'schema', name: 'tagOpen' },
    sections: { type: 'schema', name: 'tagSections' },
    contracts: { type: 'schema', name: 'tagContracts' },
    identity: { type: 'schema', name: 'tagIdentity' },
    layer: { type: 'schema', name: 'keyedLayer' },
    fork: { type: 'schema', name: 'typeFork' },
  },
  edges: ['relates'],
  gates: [{ gate: 'required', field: 'id' }],
  roles: {},
  body: { shape: 'content' },
  prompt: [
    'A `#tag` node declares a tag — the fields, edges and sources its nodes may carry, write gates, core',
    'roles, body shape; its body is the prompt every node of the tag is read with. A shipped catalog is',
    'the same declaration in TypeScript, installed here, so your own tag is checked, gated and role-bound',
    'exactly as a shipped one, with no redeploy. A shipped text — tag prompt or catalog guidance — takes',
    "this project's own part written after it and keeps receiving its updates; any other rewrite stands",
    'as a finding until it becomes that part, a declared fork, or the shipped text again.',
  ].join(' '),
};

export const TAG_DEFAULTS = {
  fields: {},
  edges: [],
  gates: [],
  roles: {},
  body: { shape: 'content' },
} as const satisfies Pick<Tag, 'fields' | 'edges' | 'gates' | 'roles' | 'body'>;
