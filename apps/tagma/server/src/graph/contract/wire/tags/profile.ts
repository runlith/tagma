import { Effect, Result, Schema } from 'effect';
import { GateRefusal } from '../../../../platform/contract/wire/refusal.js';
import { type ContractId, contractIdSchema } from './behaviour.js';
import type { Tag } from './declaration.js';
import type { TagTable } from './table.js';
import { spellsTypeId, type TypeIdentities } from './identity.js';

export const typeRefSchema = Schema.NonEmptyString.check(
  Schema.makeFilter((type) => spellsTypeId(type) || 'a profile names a type by its permanent type id'),
);
export type TypeRef = typeof typeRefSchema.Type;

export const batchGuidanceSchema = Schema.Struct({
  type: typeRefSchema,
  field: Schema.NonEmptyString,
  unblock: Schema.NonEmptyString,
});
export type BatchGuidance = typeof batchGuidanceSchema.Type;

export const checksProfileSchema = Schema.Struct({ code: Schema.Boolean });

export const creationDefaultSchema = Schema.Struct({
  contract: contractIdSchema,
  type: typeRefSchema,
  override: Schema.optional(Schema.Literal(true)),
});
export type CreationDefault = typeof creationDefaultSchema.Type;

export type CreationDefaultRefusal = 'creation-default-missing' | 'creation-default-ambiguous' | 'creation-default-invalid';

export const creationType = (
  table: TagTable,
  contract: ContractId,
  defaults: readonly CreationDefault[],
  unblock: readonly string[] = [],
): Effect.Effect<Tag, GateRefusal<CreationDefaultRefusal>> => {
  const overrides = defaults.filter((entry) => entry.override === true);
  const selected = overrides.length === 0 ? defaults : overrides;
  if (selected.length === 0) {
    return new GateRefusal('creation-default-missing', `no installed catalog profile selects a creation type for ${contract}`, [
      `set profile.defaults to select a permanent type id supporting ${contract}`,
      ...unblock,
    ]);
  }
  if (selected.length !== 1) {
    return new GateRefusal(
      'creation-default-ambiguous',
      `${contract} has ${selected.length} creation defaults: ${selected.map((entry) => entry.type).join(', ')}`,
      [`keep one default for ${contract}, or one explicit override in an installed catalog profile`],
    );
  }
  const entry = selected[0]!;
  const key = table.identities.resolveStoredType(entry.type);
  const tag = key === null ? null : table.tagById(key);
  if (tag === null || !table.supports({ tags: [tag.id] }, contract)) {
    return new GateRefusal(
      'creation-default-invalid',
      `${entry.type} selected for ${contract} ${tag === null ? 'resolves to no readable type' : 'does not support the required contract'}`,
      [`set profile.defaults for ${contract} to the permanent id of a readable type supporting that contract`],
    );
  }
  return Effect.succeed(tag);
};

export const catalogProfileSchema = Schema.Struct({
  defaults: Schema.optional(Schema.Array(creationDefaultSchema)),
  batch: Schema.optional(Schema.Array(batchGuidanceSchema)),
  checks: Schema.optional(checksProfileSchema),
});
export type CatalogProfile = typeof catalogProfileSchema.Type;

const decodeProfile = Schema.decodeUnknownResult(catalogProfileSchema);

export type StoredProfile = Result.Result<CatalogProfile | null, Schema.SchemaError>;

export const storedProfile = (fields: Readonly<Record<string, unknown>>): StoredProfile => {
  const release = fields.release;
  const inRelease =
    typeof release === 'object' && release !== null && !Array.isArray(release)
      ? (release as Readonly<Record<string, unknown>>).profile
      : undefined;
  const stored = fields.profile !== undefined ? fields.profile : inRelease;
  return stored === undefined ? Result.succeed(null) : decodeProfile(stored);
};

export type Resolved = { readonly keys: readonly string[]; readonly missing: readonly TypeRef[] };

export const resolveTypes = (identities: TypeIdentities, refs: readonly TypeRef[]): Resolved => {
  const keys: string[] = [];
  const missing: TypeRef[] = [];
  for (const ref of refs) {
    const key = identities.resolveStoredType(ref);
    if (key === null) missing.push(ref);
    else keys.push(key);
  }
  return { keys: [...new Set(keys)], missing };
};

export const codeChecksOf = (profiles: readonly CatalogProfile[]): boolean => profiles.some((profile) => profile.checks?.code === true);

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const eachObject = (value: unknown, change: (item: Readonly<Record<string, unknown>>) => unknown): unknown =>
  Array.isArray(value) ? value.map((item) => (isObject(item) ? change(item) : item)) : value;

export const pinProfileTypes = (pin: (word: unknown) => unknown, profile: unknown): unknown => {
  if (!isObject(profile)) return profile;
  const pinned: Record<string, unknown> = { ...profile };
  if (profile.defaults !== undefined) pinned.defaults = eachObject(profile.defaults, (entry) => ({ ...entry, type: pin(entry.type) }));
  if (profile.batch !== undefined) pinned.batch = eachObject(profile.batch, (entry) => ({ ...entry, type: pin(entry.type) }));
  return pinned;
};
