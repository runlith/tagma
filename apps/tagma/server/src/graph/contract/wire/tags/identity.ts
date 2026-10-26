import { Schema } from 'effect';

export const tagIdentitySchema = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyString),
  fields: Schema.optional(Schema.Record(Schema.String, Schema.NonEmptyString)),
  shipped: Schema.optional(Schema.Struct({ library: Schema.NonEmptyString, export: Schema.NonEmptyString })),
});
export type TagIdentity = typeof tagIdentitySchema.Type;

export const IDENTITY_FORMAT = 2;

export const CORE_LIBRARY = 'core';

export type Shipped = { readonly library: string; readonly export: string; readonly version: string | null };

export type TypeIdentity = {
  readonly id: string;
  readonly ids: readonly string[];
  readonly key: string;
  readonly name: string;
  readonly declaration: string | null;
  readonly shipped: Shipped | null;
};

export type ShippedRef = { readonly library: string; readonly export: string };

export type InstalledRelease = {
  readonly library: string;
  readonly version: string;
  readonly exports: readonly string[];
  readonly members: readonly string[];
};

const SHIPPED = 'shipped:';
const LOCAL = 'local:';

export const shippedTypeId = (library: string, exported: string): string =>
  `${SHIPPED}${encodeURIComponent(library)}/${encodeURIComponent(exported)}`;

export const localTypeId = (declaration: string): string => `${LOCAL}${encodeURIComponent(declaration)}`;

export const fieldIdOf = (typeId: string, fieldKey: string): string => `${typeId}#${encodeURIComponent(fieldKey)}`;

export const spellsTypeId = (word: string): boolean => word.startsWith(SHIPPED) || word.startsWith(LOCAL);

export interface TypeIdentities {
  readonly collisions: readonly string[];
  keys(): readonly string[];
  keyOf(word: string): string | null;
  resolveStoredType(word: string): string | null;
  typeOf(word: string): TypeIdentity | null;
  declaredBy(declaration: string): TypeIdentity | null;
  holderOf(name: string, except?: string): string | null;
  resolveStoredField(typeKey: string, word: string): string | null;
  fieldKeyOf(typeKey: string, word: string): string | null;
  fieldNameOf(typeKey: string, fieldKey: string): string;
  fieldIdOf(typeKey: string, fieldKey: string): string | null;
  assignKey(library: string, exported: string, claimed?: ReadonlySet<string>): string;
}
