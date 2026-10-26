import { Schema } from 'effect';
import type { FieldSchemaName, ScalarFieldType } from './declaration.js';
import type { StatusPhase } from './roles.js';

export type ContractId = `core/${string}`;

export const contractIdSchema = Schema.TemplateLiteral(['core/', Schema.NonEmptyString]);

export type SlotKind = ScalarFieldType | 'enum' | { readonly schema: FieldSchemaName };

export type BehaviourSlot = {
  readonly kind?: SlotKind;
  readonly state?: string;
  readonly optional?: true;
};

export type BehaviourWord = { readonly slot: string; readonly contract?: ContractId; readonly optional?: true };

export type ActionMove = {
  readonly to: string;
  readonly contract?: ContractId;
  readonly from?: StatusPhase;
  readonly needs?: readonly string[];
  readonly says?: string;
  readonly label?: string;
};

export type BehaviourAction = { readonly op: string; readonly moves?: readonly ActionMove[]; readonly writes?: readonly string[] };

export type EdgeMeaning = 'dependency' | 'implementation';

export type BehaviourEdge = {
  readonly kind: string;
  readonly from: ContractId;
  readonly to: ContractId;
  readonly meaning: EdgeMeaning;
  readonly acyclic?: true;
  readonly standing?: true;
};

export const contractBindingSchema = Schema.Struct({
  slots: Schema.Record(Schema.NonEmptyString, Schema.NonEmptyString),
  words: Schema.Record(Schema.NonEmptyString, Schema.NonEmptyString),
});
export type ContractBinding = typeof contractBindingSchema.Type;

export const contractBindingsSchema = Schema.Record(contractIdSchema, contractBindingSchema);
export type ContractBindings = typeof contractBindingsSchema.Type;

export type Bound = { readonly contract: ContractId; readonly binding: ContractBinding; readonly from: string };
