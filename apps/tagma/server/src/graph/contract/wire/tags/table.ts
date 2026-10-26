import { type Effect, Schema } from 'effect';
import type { GateRefusal } from '../../../../platform/contract/wire/refusal.js';
import type { StatusPhase, TagWords } from './roles.js';
import { type Declaration, installedCatalogSchema, type Tag, tagSchema } from './declaration.js';
import type { TypeIdentities } from './identity.js';
import { lawProjectionSchema } from './law.js';
import type { TagReading } from './reading.js';
import type { Provenance } from './provenance.js';
import { vocabularyRevisionSchema } from './revision.js';
import { catalogFindingSchema } from './findings.js';
import type { BehaviourEdge, ContractId, EdgeMeaning } from './behaviour.js';
import type { CreationDefaultRefusal } from './profile.js';
import { type NodeActions, tagActionsSchema } from './actions.js';

export type SlotField = { readonly tag: string; readonly name: string };

export const unreadableTagSchema = Schema.Struct({
  name: Schema.String,
  id: Schema.String,
  reason: Schema.String,
});
export type UnreadableTag = typeof unreadableTagSchema.Type;

export const vocabularySchema = Schema.Struct({
  revision: vocabularyRevisionSchema,
  catalogs: Schema.Array(Schema.String),
  installed: Schema.Array(installedCatalogSchema),
  findings: Schema.Array(catalogFindingSchema),
  tags: Schema.Array(tagSchema),
  unreadable: Schema.Array(unreadableTagSchema),
  actions: Schema.Record(Schema.String, tagActionsSchema),
  fieldNames: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
  forms: Schema.Record(Schema.String, Schema.String).annotate({ description: 'The accepted form of each field schema the tags name.' }),
  laws: Schema.Record(Schema.String, lawProjectionSchema),
});
export type Vocabulary = typeof vocabularySchema.Type;

export type Redeclared = { readonly type: string; readonly was: Tag | null; readonly now: Tag };

export type DeclaringNode = { readonly id: string; readonly name: string };

export interface TagTable extends TagReading {
  readonly identities: TypeIdentities;
  bindsCode(): boolean;
  readonly contracts: readonly ContractId[];
  edgeRule(kind: string): BehaviourEdge | null;
  semanticEdges(meaning: EdgeMeaning): readonly BehaviourEdge[];
  typesSupporting(contract: ContractId): readonly string[];
  creationType(contract: ContractId): Effect.Effect<Tag, GateRefusal<CreationDefaultRefusal>>;
  actionsOn(node: { readonly tags: readonly string[] }): NodeActions;
  slotFields(contract: ContractId, slot: string): readonly SlotField[];
  wordsAt(contract: ContractId, phase: StatusPhase): readonly TagWords[];
  hiddenStatuses(): readonly string[];
  tagsWithField(name: string): string[];
  lawBearingTypes(): readonly string[];
  provenanceOf(typeId: string): Provenance | null;
  descendantsOf(typeId: string | readonly string[]): readonly string[];
  redeclare(declaration: Declaration, replacing: DeclaringNode | null): Effect.Effect<readonly Redeclared[], GateRefusal<'tag-incoherent'>>;
}
