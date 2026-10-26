import { Result, Schema } from 'effect';
import { SPOKEN_LENGTH } from '../../platform/contract/wire/ids.js';
import { blockName } from '../contract/wire/references.js';
import { closedParsing } from '../contract/wire/fields.js';
import type { UnreadableTag } from '../contract/wire/tags/table.js';
import { catalogFieldsSchema } from '../contract/wire/tags/declaration.js';
import { type CatalogProfile, storedProfile } from '../contract/wire/tags/profile.js';
import {
  CORE_LIBRARY,
  fieldIdOf,
  type InstalledRelease,
  localTypeId,
  type Shipped,
  type ShippedRef,
  shippedTypeId,
  type TagIdentity,
  tagIdentitySchema,
  type TypeIdentities,
  type TypeIdentity,
} from '../contract/wire/tags/identity.js';

export type NamedDeclaration = { readonly uuid: string; readonly identity: TagIdentity | null };

export type Naming = {
  readonly declarations: ReadonlyMap<string, NamedDeclaration>;
  readonly releases: readonly InstalledRelease[];
  readonly profiles: readonly CatalogProfile[];
  readonly profileErrors: readonly string[];
};

export const NO_NAMING: Naming = { declarations: new Map(), releases: [], profiles: [], profileErrors: [] };

export type VocabularyRow = { readonly uuid: string; readonly fields: Readonly<Record<string, unknown>> };

const decodeIdentity = (input: unknown) => Schema.decodeUnknownResult(tagIdentitySchema)(input, closedParsing);
const decodeCatalog = Schema.decodeUnknownResult(catalogFieldsSchema);

export function namingOf(
  declarations: readonly VocabularyRow[],
  catalogs: readonly VocabularyRow[],
): { readonly naming: Naming; readonly unreadable: readonly UnreadableTag[] } {
  const unreadable: UnreadableTag[] = [];
  const bySuffix = new Map<string, { readonly name: string; readonly compact: string }[]>();
  const named = new Map<string, NamedDeclaration | null>();
  for (const row of declarations) {
    const name = blockName(row.uuid);
    const compact = row.uuid.replaceAll('-', '').toLowerCase();
    const suffix = compact.slice(-SPOKEN_LENGTH);
    bySuffix.set(suffix, [...(bySuffix.get(suffix) ?? []), { name, compact }]);
    const read = row.fields.identity === undefined ? null : decodeIdentity(row.fields.identity);
    if (read?._tag === 'Failure') {
      unreadable.push({
        name,
        id: typeof row.fields.id === 'string' ? row.fields.id : '',
        reason: `its identity is written in a shape this grammar cannot read: ${read.failure.message}`,
      });
    }
    named.set(name, named.has(name) ? null : { uuid: compact, identity: read?._tag === 'Success' ? read.success : null });
  }
  const memberOf = (ref: string): string | null => {
    const tail = ref.replaceAll('-', '').toLowerCase();
    const found = (bySuffix.get(tail.slice(-SPOKEN_LENGTH)) ?? []).filter((entry) => entry.compact.endsWith(tail));
    return found.length === 1 ? found[0]!.name : null;
  };
  const releases: InstalledRelease[] = [];
  const profiles: CatalogProfile[] = [];
  const profileErrors: string[] = [];
  for (const row of catalogs) {
    const profile = storedProfile(row.fields);
    if (Result.isFailure(profile)) {
      const id = typeof row.fields.id === 'string' ? row.fields.id : '';
      unreadable.push({
        name: blockName(row.uuid),
        id,
        reason: `its profile cannot be read, so it selects nothing: ${profile.failure.message}`,
      });
      profileErrors.push(`${blockName(row.uuid)} (${id}): ${profile.failure.message}`);
    } else if (profile.success !== null) {
      profiles.push(profile.success);
    }
    if (row.fields.release === undefined) continue;
    const read = decodeCatalog(row.fields);
    if (read._tag === 'Failure') {
      unreadable.push({
        name: blockName(row.uuid),
        id: typeof row.fields.id === 'string' ? row.fields.id : '',
        reason: `its release cannot be read, so no type it shipped is known as shipped: ${read.failure.message}`,
      });
      continue;
    }
    const { id, tags, release } = read.success;
    if (release === undefined) continue;
    releases.push({
      library: id,
      version: release.revision,
      exports: release.tags.map((tag) => tag.id),
      members: tags.flatMap((ref) => memberOf(ref) ?? []),
    });
  }
  const sole = new Map<string, NamedDeclaration>();
  for (const [name, declaration] of named) if (declaration !== null) sole.set(name, declaration);
  return { naming: { declarations: sole, releases, profiles, profileErrors }, unreadable };
}

export type DeclaredType = {
  readonly key: string;
  readonly declaration: string;
  readonly uuid: string;
  readonly identity: TagIdentity | null;
};

export type FieldOrigins = {
  fieldsOf(typeKey: string): readonly string[];
  originOf(typeKey: string, fieldKey: string): string | null;
};

const NO_FIELDS: FieldOrigins = { fieldsOf: () => [], originOf: () => null };

type Verified = { readonly first: ShippedRef; readonly current: Shipped };

function verified(type: DeclaredType, releases: readonly InstalledRelease[]): Verified | null {
  const claimed = type.identity?.shipped;
  const found = releases.flatMap((release): Verified[] => {
    const current = (exported: string): Shipped => ({ library: release.library, export: exported, version: release.version });
    if (claimed === undefined)
      return release.exports.includes(type.key)
        ? [{ first: { library: release.library, export: type.key }, current: current(type.key) }]
        : [];
    return release.library === claimed.library && release.exports.includes(claimed.export)
      ? [{ first: claimed, current: current(claimed.export) }]
      : [];
  });
  return found.length === 1 ? found[0]! : null;
}

function membership(releases: readonly InstalledRelease[]): Map<string, InstalledRelease[]> {
  const of = new Map<string, InstalledRelease[]>();
  for (const release of releases) for (const member of release.members) of.set(member, [...(of.get(member) ?? []), release]);
  return of;
}

export class Identities implements TypeIdentities {
  private readonly byKey = new Map<string, TypeIdentity>();
  private readonly keyById = new Map<string, string | null>();
  private readonly keyByDeclaration = new Map<string, string>();
  private readonly keysByName = new Map<string, string[]>();
  private readonly fieldNames = new Map<string, Readonly<Record<string, string>>>();
  readonly collisions: readonly string[];

  constructor(
    core: readonly string[],
    declared: readonly DeclaredType[],
    releases: readonly InstalledRelease[],
    private readonly origins: FieldOrigins = NO_FIELDS,
  ) {
    const members = membership(releases);
    const shipped = new Map(declared.map((type) => [type.key, verified(type, members.get(type.declaration) ?? [])] as const));
    const firstOf = (type: DeclaredType): string | null => {
      const recorded = type.identity?.shipped;
      if (recorded !== undefined) return shippedTypeId(recorded.library, recorded.export);
      const found = shipped.get(type.key) ?? null;
      return found === null ? null : shippedTypeId(found.first.library, found.first.export);
    };
    const claims = new Map<string, number>();
    for (const type of declared) {
      const first = firstOf(type);
      if (first !== null) claims.set(first, (claims.get(first) ?? 0) + 1);
    }
    for (const key of core) {
      const id = shippedTypeId(CORE_LIBRARY, key);
      this.add({ id, ids: [id], key, name: key, declaration: null, shipped: { library: CORE_LIBRARY, export: key, version: null } });
    }
    for (const type of declared) {
      if (this.byKey.has(type.key)) continue;
      const first = firstOf(type);
      const owned = first !== null && claims.get(first) === 1 ? first : null;
      const sole = owned === null ? null : (shipped.get(type.key) ?? null);
      const local = localTypeId(type.uuid);
      const id = owned ?? local;
      const current = sole === null ? null : shippedTypeId(sole.current.library, sole.current.export);
      this.add({
        id,
        ids: [...new Set([id, ...(current === null ? [] : [current]), local])],
        key: type.key,
        name: type.identity?.name ?? type.key,
        declaration: type.declaration,
        shipped: sole?.current ?? null,
      });
      this.keyByDeclaration.set(type.declaration, type.key);
      if (type.identity?.fields !== undefined) this.fieldNames.set(type.key, type.identity.fields);
    }
    this.collisions = [
      ...[...this.byKey.keys()].filter((key) => this.keyById.has(key) && this.keyById.get(key) !== key),
      ...[...this.keyById.entries()].flatMap(([id, key]) => (key === null ? [id] : [])),
    ];
  }

  private add(type: TypeIdentity): void {
    this.byKey.set(type.key, type);
    for (const id of type.ids) this.keyById.set(id, this.keyById.has(id) ? null : type.key);
    if (type.name === type.key) return;
    this.keysByName.set(type.name, [...(this.keysByName.get(type.name) ?? []), type.key]);
  }

  keys(): readonly string[] {
    return [...this.byKey.keys()];
  }

  declaredBy(declaration: string): TypeIdentity | null {
    const key = this.keyByDeclaration.get(declaration);
    return key === undefined ? null : (this.byKey.get(key) ?? null);
  }

  keyOf(word: string): string | null {
    const named = this.keysByName.get(word);
    return this.resolveStoredType(word) ?? (named?.length === 1 ? named[0]! : null);
  }

  resolveStoredType(word: string): string | null {
    if (!this.keyById.has(word)) return this.byKey.has(word) ? word : null;
    const asId = this.keyById.get(word) ?? null;
    return this.byKey.has(word) && asId !== word ? null : asId;
  }

  typeOf(word: string): TypeIdentity | null {
    const key = this.keyOf(word);
    return key === null ? null : (this.byKey.get(key) ?? null);
  }

  holderOf(name: string, except?: string): string | null {
    const holders = [
      ...(this.byKey.has(name) ? [name] : []),
      ...(this.keyById.has(name) ? [this.keyById.get(name) ?? name] : []),
      ...(this.keysByName.get(name) ?? []),
    ];
    return holders.find((key) => key !== except) ?? null;
  }

  fieldIdOf(typeKey: string, fieldKey: string): string | null {
    const origin = this.origins.originOf(typeKey, fieldKey);
    const declaring = origin === null ? null : this.byKey.get(origin);
    return declaring === undefined || declaring === null ? null : fieldIdOf(declaring.id, fieldKey);
  }

  resolveStoredField(typeKey: string, word: string): string | null {
    const fields = this.origins.fieldsOf(typeKey);
    if (fields.includes(word)) return word;
    return fields.find((field) => this.fieldIdOf(typeKey, field) === word) ?? null;
  }

  fieldKeyOf(typeKey: string, word: string): string | null {
    const stored = this.resolveStoredField(typeKey, word);
    if (stored !== null) return stored;
    const named = this.origins.fieldsOf(typeKey).filter((field) => this.fieldNameOf(typeKey, field) === word);
    return named.length === 1 ? named[0]! : null;
  }

  fieldNameOf(typeKey: string, fieldKey: string): string {
    const origin = this.origins.originOf(typeKey, fieldKey);
    return (origin === null ? undefined : this.fieldNames.get(origin)?.[fieldKey]) ?? fieldKey;
  }

  assignKey(library: string, exported: string, claimed?: ReadonlySet<string>): string {
    const taken = (key: string) => this.holderOf(key) !== null || claimed?.has(key) === true;
    if (!taken(exported)) return exported;
    const qualified = `${encodeURIComponent(library)}.${exported}`;
    let key = qualified;
    for (let next = 2; taken(key); next += 1) key = `${qualified}.${next}`;
    return key;
  }
}
