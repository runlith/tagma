import { Effect, Result, Schema } from 'effect';
import { canonicalJson } from '@runlith/utils/object';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { closedParsing } from '../contract/wire/fields.js';
import { CATALOG_DECLARATION, type FieldType, type Tag, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { IDENTITY_FORMAT, spellsTypeId, type TagIdentity, tagIdentitySchema, type TypeIdentities } from '../contract/wire/tags/identity.js';
import { VOCABULARY_FORMAT } from '../contract/wire/tags/revision.js';
import { pinProfileTypes } from '../contract/wire/tags/profile.js';
import { declaringTag } from './declarationRules.js';

export const writesIdentity: boolean = (VOCABULARY_FORMAT as number) >= IDENTITY_FORMAT;

type NamingRefusal = 'vocabulary-older' | 'field-invalid' | 'operation-only' | 'tag-declared';

const decodeIdentity = (input: unknown) => Schema.decodeUnknownResult(tagIdentitySchema)(input, closedParsing);

const unwritable = (what: string): GateRefusal<'vocabulary-older'> =>
  new GateRefusal(
    'vocabulary-older',
    `${what} is written under vocabulary format ${IDENTITY_FORMAT}, and this server writes format ${VOCABULARY_FORMAT}`,
    [
      `keep the type under the key it carries: every node, reference and saved query keeps reading it`,
      `run a Tagma release that writes vocabulary format ${IDENTITY_FORMAT}, then write it again`,
    ],
  );

export function assertKeyFree(
  identities: TypeIdentities,
  key: string,
  own: string | null,
): Effect.Effect<void, GateRefusal<'tag-declared' | 'field-invalid'>> {
  if (spellsTypeId(key)) {
    return new GateRefusal('field-invalid', `"${key}" is spelled as a permanent type id, so a reference could not tell the two apart`, [
      'choose an id that does not begin with shipped: or local:',
    ]);
  }
  const holder = identities.holderOf(key, own ?? undefined);
  if (holder === null || holder === key) return Effect.void;
  return new GateRefusal('tag-declared', `#${holder} already answers to "${key}" as its name`, [
    `choose another id for this declaration`,
    `rename #${holder} first, through its identity.name, if "${key}" should name this one`,
  ]);
}

export function identityWrite(
  identities: TypeIdentities,
  own: string,
  declared: readonly string[],
  standing: unknown,
  written: unknown,
): Effect.Effect<TagIdentity, GateRefusal<NamingRefusal>> {
  if (!writesIdentity) return unwritable(`#${own}.identity`);
  const read = decodeIdentity(written);
  if (read._tag === 'Failure') {
    return new GateRefusal('field-invalid', `#${own}.identity: ${read.failure.message}`, [
      'an identity is {name?, fields?: {key: name}}: the names the type and its own fields answer to; the installer writes shipped',
    ]);
  }
  const aliases = Object.entries(read.success.fields ?? {});
  for (const [key, alias] of aliases) {
    if (!declared.includes(key)) {
      return new GateRefusal('field-invalid', `#${own}.identity.fields names "${key}", which #${own} does not declare itself`, [
        `name a field #${own} declares: ${declared.join(', ') || 'it declares none'}; an inherited field takes its name on the type that declares it`,
      ]);
    }
    const holder = identities.fieldKeyOf(own, alias);
    const taken =
      declared.includes(alias) || (holder !== null && holder !== key) || aliases.some(([other, name]) => other !== key && name === alias);
    if (alias !== key && taken) {
      return new GateRefusal(
        'field-invalid',
        `#${own}.identity.fields gives "${key}" the name "${alias}", which another field of #${own} answers to`,
        ['choose a name no other field of the type carries as its key or its name'],
      );
    }
  }
  const was = standing === undefined || standing === null ? null : decodeIdentity(standing);
  if (was !== null && was._tag === 'Failure') {
    return new GateRefusal('field-invalid', `#${own}.identity as it stands does not read: ${was.failure.message}`, [
      `restore #${own}'s file from the graph tree's history, then write its identity again`,
    ]);
  }
  const shipped = was?.success.shipped;
  const next = read.success;
  if (next.shipped !== undefined && canonicalJson(next.shipped) !== canonicalJson(shipped)) {
    return new GateRefusal('operation-only', `#${own}.identity.shipped is installation provenance`, [
      'rename the type through identity.name; the installer records which release it shipped in',
    ]);
  }
  if (next.name !== undefined && spellsTypeId(next.name)) {
    return new GateRefusal('field-invalid', `#${own}.identity.name "${next.name}" is spelled as a permanent type id`, [
      'choose a name that does not begin with shipped: or local:',
    ]);
  }
  if (next.name !== undefined && next.name !== own) {
    const holder = identities.holderOf(next.name, own);
    if (holder !== null) {
      return new GateRefusal('tag-declared', `#${holder} already answers to "${next.name}"`, [
        `choose a name no other type of this project carries as its key, its permanent id or its name`,
      ]);
    }
  }
  return Effect.succeed({ ...next, shipped });
}

export type FieldAmbiguity = { readonly name: string; readonly keys: readonly string[] };

export function fieldKeysOf(
  identities: TypeIdentities,
  typeKeys: readonly string[],
  fields: Readonly<Record<string, unknown>>,
): Result.Result<Record<string, unknown>, FieldAmbiguity> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    const keys = [...new Set(typeKeys.flatMap((type) => identities.fieldKeyOf(type, name) ?? []))];
    if (keys.length > 1 && !keys.includes(name)) return Result.fail({ name, keys });
    out[keys.length === 1 ? keys[0]! : name] = value;
  }
  return Result.succeed(out);
}

const ambiguous = (where: string, { name, keys }: FieldAmbiguity): GateRefusal<'field-invalid'> =>
  new GateRefusal('field-invalid', `${where}: "${name}" names more than one field (${keys.join(', ')})`, [
    `name the field by its key: ${keys.join(' or ')}`,
  ]);

type Pin = (word: unknown) => unknown;

function pinOf(identities: TypeIdentities, unwritten: string[]): Pin {
  return (word) => {
    if (typeof word !== 'string') return word;
    const type = identities.typeOf(word);
    if (type !== null) return writesIdentity ? type.id : type.key;
    if (!writesIdentity && spellsTypeId(word)) unwritten.push(word);
    return word;
  };
}

function pinnedFields(pin: Pin, declared: unknown): unknown {
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) return declared;
  return Object.fromEntries(
    Object.entries(declared as Record<string, FieldType>).map(([name, type]) =>
      typeof type === 'object' && type.type === 'ref' && type.tag !== undefined ? [name, { ...type, tag: pin(type.tag) }] : [name, type],
    ),
  );
}

const words = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export function selectedTypes(identities: TypeIdentities, tags: unknown, selector: unknown): readonly string[] {
  const named = [
    ...words(tags),
    ...(typeof selector === 'object' && selector !== null && 'types' in selector ? words(selector.types) : []),
  ];
  return named.length === 0 ? identities.keys() : named.flatMap((word) => identities.keyOf(word) ?? []);
}

function pinnedQuery(pin: Pin, identities: TypeIdentities, query: unknown, unclear: FieldAmbiguity[]): unknown {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) return query;
  const selection = query as { readonly tags?: unknown; readonly selector?: unknown; readonly fields?: unknown };
  const selector = selection.selector;
  const filter = selection.fields;
  const keyed =
    typeof filter !== 'object' || filter === null || Array.isArray(filter)
      ? null
      : fieldKeysOf(identities, selectedTypes(identities, selection.tags, selector), filter as Readonly<Record<string, unknown>>);
  if (keyed !== null && Result.isFailure(keyed)) unclear.push(keyed.failure);
  return {
    ...selection,
    tags: Array.isArray(selection.tags) ? selection.tags.map(pin) : selection.tags,
    selector:
      typeof selector === 'object' && selector !== null && 'types' in selector && Array.isArray(selector.types)
        ? { ...selector, types: selector.types.map(pin) }
        : selector,
    fields: keyed !== null && Result.isSuccess(keyed) ? keyed.success : selection.fields,
  };
}

function pinnedGates(pin: Pin, gates: unknown): unknown {
  if (!Array.isArray(gates)) return gates;
  return gates.map((gate: unknown) =>
    typeof gate === 'object' && gate !== null && (gate as { gate?: unknown }).gate === 'open-children'
      ? { ...gate, tag: pin((gate as { tag?: unknown }).tag) }
      : gate,
  );
}

export const namedWrite = Effect.fn('Vocabulary.namedWrite')(function* (
  identities: TypeIdentities,
  tags: readonly Tag[],
  standing: Readonly<Record<string, unknown>> | null,
  written: Readonly<Record<string, unknown>>,
): Effect.fn.Return<Record<string, unknown>, GateRefusal<NamingRefusal>> {
  const keyed = fieldKeysOf(
    identities,
    tags.map((tag) => tag.id),
    written,
  );
  if (Result.isFailure(keyed)) return yield* ambiguous('a field this write names', keyed.failure);
  const unwritten: string[] = [];
  const unclear: FieldAmbiguity[] = [];
  const fields = pinReferences(pinOf(identities, unwritten), identities, unclear, tags, keyed.success);
  if (unwritten.length > 0) return yield* unwritable(`a reference to ${unwritten.join(', ')}`);
  if (unclear.length > 0) return yield* ambiguous('a saved query this write names', unclear[0]!);
  if (tags.some((tag) => tag.id === CATALOG_DECLARATION.id) && standing !== null)
    yield* assertCatalogProvenance(identities, standing, fields);
  if (!tags.some((tag) => tag.id === TAG_DECLARATION.id)) return fields;
  const was = typeof standing?.id === 'string' ? standing.id : null;
  const key = typeof fields.id === 'string' ? fields.id : was;
  if (key === null) return fields;
  if (key !== was) yield* assertKeyFree(identities, key, was);
  if (fields.identity !== undefined) {
    fields.identity = yield* identityWrite(
      identities,
      key,
      ownFields(fields.fields ?? standing?.fields),
      standing?.identity,
      fields.identity,
    );
  }
  return fields;
});

const ownFields = (declared: unknown): readonly string[] =>
  typeof declared === 'object' && declared !== null && !Array.isArray(declared) ? Object.keys(declared) : [];

function pinReferences(
  pin: Pin,
  identities: TypeIdentities,
  unclear: FieldAmbiguity[],
  tags: readonly Tag[],
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    const type = declaringTag(tags, name)?.fields[name];
    const schema = typeof type === 'object' && type.type === 'schema' ? type.name : null;
    out[name] =
      schema === 'tagExtends'
        ? pin(value)
        : schema === 'tagFields'
          ? pinnedFields(pin, value)
          : schema === 'blockQuery'
            ? pinnedQuery(pin, identities, value, unclear)
            : schema === 'tagGates'
              ? pinnedGates(pin, value)
              : schema === 'catalogProfile'
                ? pinProfileTypes(pin, value)
                : value;
  }
  return out;
}

const names = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function assertCatalogProvenance(
  identities: TypeIdentities,
  standing: Readonly<Record<string, unknown>>,
  written: Readonly<Record<string, unknown>>,
): Effect.Effect<void, GateRefusal<'operation-only'>> {
  if (standing.release === undefined || typeof standing.id !== 'string') return Effect.void;
  const library = standing.id;
  if (written.id !== undefined && written.id !== library) {
    return new GateRefusal(
      'operation-only',
      `catalog "${library}" is installed, and its id is the library its members' permanent ids name`,
      ['keep the id; edit the catalog guidance or add members instead'],
    );
  }
  if (written.tags === undefined) return Effect.void;
  const kept = new Set(names(written.tags).map((name) => name.toLowerCase()));
  const shipped = names(standing.tags).find(
    (name) => !kept.has(name.toLowerCase()) && identities.declaredBy(name)?.shipped?.library === library,
  );
  if (shipped === undefined) return Effect.void;
  return new GateRefusal(
    'operation-only',
    `${shipped} shipped in catalog "${library}", and its membership is the provenance of its permanent id`,
    [`keep ${shipped} in the catalog's tags; drop only members this project added`],
  );
}
