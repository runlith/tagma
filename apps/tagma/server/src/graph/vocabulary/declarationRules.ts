import { Data, Effect, Result, Schema } from 'effect';
import { canonicalJson } from '@runlith/utils/object';
import { type AmendmentOp, amendmentOpSchema } from '../contract/wire/batch.js';
import { type LawEnforcement, lawEnforcementSchema } from '../contract/wire/enforcement.js';
import { type ModuleEntries, moduleEntriesSchema, type ModuleOrder, moduleOrderSchema } from '../contract/wire/modules.js';
import { closedParsing, line, nameRef } from '../contract/wire/fields.js';
import { type BlockQuery, type ViewLayout, blockQuerySchema, GROUP_FIELDS, viewLayoutSchema } from '../contract/wire/query.js';
import { SOURCE_KINDS } from '../contract/wire/sources.js';
import { type ResearchSource, researchSourceSchema } from '../contract/wire/records.js';
import { blockName, isBlockName } from '../contract/wire/references.js';
import { AMENDMENT_VERDICTS, fieldName, statusTargets, statusWords, terminalStatuses } from '../contract/wire/tags/roles.js';
import {
  type BodyShape,
  bodyShapeSchema,
  type CatalogRelease,
  catalogReleaseSchema,
  type Declaration,
  FIELD_SCHEMA_NAMES,
  type FieldSchemaName,
  type FieldType,
  type Gate,
  OWNED_ROLES,
  type OwnedRole,
  ROLES,
  SCALAR_FIELD_TYPES,
  type ScalarFieldType,
  type Slot,
  SLOTS,
  type Tag,
  TAG_DECLARATION,
  tagEdgesSchema,
  tagExtendsSchema,
  tagFieldsSchema,
  tagGatesSchema,
  tagOpenSchema,
  tagRolesSchema,
  tagSourcesSchema,
} from '../contract/wire/tags/declaration.js';
import { type TagIdentity, tagIdentitySchema } from '../contract/wire/tags/identity.js';
import {
  type Section,
  SECTION_EDITS,
  tagSectionsSchema,
  type KeyedLayer,
  keyedLayerSchema,
  type Fork,
  forkSchema,
  type GuidanceFork,
  guidanceForkSchema,
} from '../contract/wire/tags/sections.js';
import { type ContractBindings, contractBindingsSchema } from '../contract/wire/tags/behaviour.js';
import { type CatalogProfile, catalogProfileSchema } from '../contract/wire/tags/profile.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Candidate } from './compiler.js';

type FieldCodec = Schema.Codec<unknown, unknown, never, never>;
type FieldDecoder = (input: unknown) => Result.Result<unknown, Schema.SchemaError>;

const SCALARS = {
  string: Schema.String,
  number: Schema.Finite,
  boolean: Schema.Boolean,
  date: Schema.DateTimeUtcFromString,
  session: Schema.Int.check(Schema.isGreaterThan(0)),
} as const satisfies Record<ScalarFieldType, FieldCodec>;

type FieldSchema = { readonly codec: FieldCodec; readonly form: string };

const words = (values: readonly string[]): string => values.map((value) => JSON.stringify(value)).join('|');
const EDITS = words(SECTION_EDITS);

const FIELD_SCHEMAS = {
  line: { codec: line, form: 'one non-blank line' },
  blockQuery: { codec: blockQuerySchema, form: 'a query_blocks input with its sort' },
  viewLayout: { codec: viewLayoutSchema, form: `{mode: "list"} | {mode: "sections"|"board", by: ${words(GROUP_FIELDS)}}` },
  amendmentOps: {
    codec: Schema.Array(amendmentOpSchema).check(Schema.isMinLength(1)),
    form: 'a non-empty list of apply_batch ops',
  },
  researchSource: { codec: researchSourceSchema, form: '{name: the system read, ref: its checkout, URL or version}' },
  tagFields: {
    codec: tagFieldsSchema,
    form: `{<field>: ${words(SCALAR_FIELD_TYPES)} | {type: "enum", values: [...]} | {type: "ref", tag?, many?: true} | {type: "schema", name}}`,
  },
  tagEdges: { codec: tagEdgesSchema, form: '[kind | {kind, to: [tag, ...]}]' },
  tagSources: { codec: tagSourcesSchema, form: `[${words(SOURCE_KINDS)}, ...]` },
  tagGates: {
    codec: tagGatesSchema,
    form: `[{gate: "transition", field, from, to} | {gate: "required", field} | {gate: "open-children", tag} | {gate: "source-required", kinds: [${words(SOURCE_KINDS)}, ...]}]`,
  },
  tagRoles: {
    codec: tagRolesSchema,
    form: '{status?: {field, initial, claimed?, done?, closed?}, amendment?: {field, run, declined, answered}, holder|law|enforcement|delivery?: field, work|spec|container|leaf|observation?: true}',
  },
  tagBody: { codec: bodyShapeSchema, form: '{shape: "content"|"orientation", cap?: UTF-16 code units}' },
  tagExtends: { codec: tagExtendsSchema, form: 'the parent type id' },
  tagOpen: { codec: tagOpenSchema, form: `[${words(SLOTS)}, ...]` },
  tagSections: { codec: tagSectionsSchema, form: `[{key, text, edits?: [${EDITS}, ...]}]` },
  tagIdentity: { codec: tagIdentitySchema, form: '{name?, fields?: {<field>: name}, shipped?: {library, export}}' },
  tagContracts: { codec: contractBindingsSchema, form: '{"core/...": {slots: {<slot>: field}, words: {<word>: enum value}}}' },
  keyedLayer: {
    codec: keyedLayerSchema,
    form: `{type: type or catalog id, edits: [{section, edit: ${EDITS}, text?, over: base revision}]}`,
  },
  typeFork: { codec: forkSchema, form: '{library, export, at: type revision}' },
  guidanceFork: { codec: guidanceForkSchema, form: '{at: guidance revision}' },
  catalogRelease: { codec: catalogReleaseSchema, form: 'written by the installer' },
  catalogProfile: {
    codec: catalogProfileSchema,
    form: '{defaults?: [{contract, type, override?: true}], batch?: [{type, field, unblock}], checks?: {code: boolean}}, types by permanent id',
  },
  lawEnforcement: { codec: lawEnforcementSchema, form: 'written by enforce_rule' },
  moduleEntries: { codec: moduleEntriesSchema, form: 'written by set_module' },
  moduleOrder: { codec: moduleOrderSchema, form: 'written by set_module' },
} as const satisfies Record<FieldSchemaName, FieldSchema>;

export const fieldForm = (name: FieldSchemaName): string => FIELD_SCHEMAS[name].form;

const CLOSED_FIELDS: ReadonlySet<FieldSchemaName> = new Set([
  'amendmentOps',
  'tagEdges',
  'tagRoles',
  'tagBody',
  'tagSections',
  'tagIdentity',
  'tagContracts',
  'keyedLayer',
  'typeFork',
  'guidanceFork',
  'catalogProfile',
  'lawEnforcement',
]);

function compile<K extends string>(
  names: readonly K[],
  codecOf: (name: K) => FieldCodec,
  closed: ReadonlySet<string>,
): Record<K, FieldDecoder> {
  const table = {} as Record<K, FieldDecoder>;
  for (const name of names) {
    const decode = Schema.decodeUnknownResult(codecOf(name));
    const options = closed.has(name) ? closedParsing : undefined;
    table[name] = (input) => decode(input, options);
  }
  return table;
}
const SCALAR_DECODERS = compile(SCALAR_FIELD_TYPES, (name) => SCALARS[name], new Set());
const SCHEMA_DECODERS = compile(FIELD_SCHEMA_NAMES, (name) => FIELD_SCHEMAS[name].codec, CLOSED_FIELDS);

function decoderOf(type: FieldType): FieldDecoder {
  if (typeof type === 'string') return SCALAR_DECODERS[type];
  if (type.type === 'schema') return SCHEMA_DECODERS[type.name];
  if (type.type === 'enum') return Schema.decodeUnknownResult(Schema.Literals(type.values));
  return Schema.decodeUnknownResult(type.many === true ? Schema.Array(nameRef) : nameRef);
}

function spell(type: FieldType | undefined): string {
  if (type === undefined) return 'a value this tag never says the type of';
  if (typeof type === 'string') return type === 'session' ? 'a session id' : `a ${type}`;
  if (type.type === 'schema') return `${type.name}: ${fieldForm(type.name)}`;
  if (type.type === 'enum') return `one of: ${type.values.join(', ')}`;
  const named = type.tag === undefined ? 'a block' : `a #${type.tag} block`;
  return type.many === true ? `a list of names, each ${named}` : `the name of ${named}`;
}

function misnamed(type: FieldType, value: unknown): string | undefined {
  if (typeof type === 'string' || type.type !== 'ref' || (type.many === true && !Array.isArray(value))) return undefined;
  const entries: readonly unknown[] = type.many === true ? (value as readonly unknown[]) : [value];
  const wrong = entries.find((entry) => typeof entry !== 'string' || !isBlockName(entry));
  return wrong === undefined ? undefined : `${JSON.stringify(wrong)} is not a block name`;
}

export function declaringTag(tags: readonly Tag[], name: string): Tag | null {
  return tags.find((tag) => tag.fields[name] !== undefined) ?? null;
}

export function bodyCap(tags: readonly Tag[]): { readonly tag: Tag; readonly cap: number } | null {
  const capped = tags.flatMap((tag) => (tag.body.cap === undefined ? [] : [{ tag, cap: tag.body.cap }]));
  return capped.sort((one, other) => one.cap - other.cap)[0] ?? null;
}

export function validateFields(
  tags: readonly Tag[],
  fields: Readonly<Record<string, unknown>>,
): Effect.Effect<void, GateRefusal<'field-invalid'>> {
  const known = [...new Set(tags.flatMap((tag) => Object.keys(tag.fields)))];
  const carried = tags.map((tag) => `#${tag.id}`).join(', ');
  for (const [name, value] of Object.entries(fields)) {
    const tag = declaringTag(tags, name);
    if (tag === null) {
      return new GateRefusal('field-invalid', `${name}: no tag of this node declares a field "${name}"`, [
        known.length === 0
          ? `${carried === '' ? 'a node with no tag' : carried} declares no fields: it carries its title and its body`
          : `the fields of ${carried}: ${known.join(', ')}`,
      ]);
    }
    const type = tag.fields[name] as FieldType;
    const read = decoderOf(type)(value);
    if (read._tag === 'Failure') {
      return new GateRefusal('field-invalid', `${tag.id}.${name}: ${misnamed(type, value) ?? read.failure.message}`, [
        `${tag.id}.${name} takes ${spell(type)}`,
      ]);
    }
  }
  return Effect.void;
}

export function assertComposable(tags: readonly Tag[]): Effect.Effect<void, GateRefusal<'field-conflict' | 'role-conflict'>> {
  const carried = tags.map((tag) => `#${tag.id}`).join(', ');
  const fields = new Map<string, Tag>();
  for (const tag of tags) {
    for (const [name, type] of Object.entries(tag.fields)) {
      const first = fields.get(name);
      if (first === undefined) {
        fields.set(name, tag);
        continue;
      }
      if (JSON.stringify(first.fields[name]) === JSON.stringify(type)) continue;
      return new GateRefusal(
        'field-conflict',
        `${carried}: #${first.id} and #${tag.id} both declare "${name}", and not as the same thing`,
        [
          `write the node with one of them: a value has one type, and a node carrying both has two`,
          `correct one declaration so ${name} means the same in each`,
        ],
      );
    }
  }
  const owners = new Map<OwnedRole, Tag>();
  for (const tag of tags) {
    for (const role of OWNED_ROLES) {
      if (tag.roles[role] === undefined) continue;
      const first = owners.get(role);
      if (first === undefined) {
        owners.set(role, tag);
        continue;
      }
      return new GateRefusal('role-conflict', `${carried}: #${first.id} and #${tag.id} both bind the ${role} role`, [
        `write the node with one of them: a verb reads the tag that OWNS this role, and two owners leave it reading whichever came first`,
        `drop the ${role} binding from one of the two declarations`,
      ]);
    }
  }
  const bound = new Map<string, { readonly tag: Tag; readonly reading: string }>();
  for (const tag of tags) {
    for (const [contract, binding] of Object.entries(tag.contracts ?? {})) {
      const reading = canonicalJson([binding, Object.values(binding.slots).map((field) => movesOf(tag, field))]);
      const first = bound.get(contract);
      if (first === undefined) {
        bound.set(contract, { tag, reading });
        continue;
      }
      if (first.reading === reading) continue;
      return new GateRefusal(
        'role-conflict',
        `${carried}: #${first.tag.id} and #${tag.id} both bind ${contract}, and not as the same binding over the same moves`,
        [
          `write the node with one of them: a verb reads the one binding of ${contract}, and two leave it reading whichever came first`,
          `bind ${contract} the same way on both declarations, with the same transitions over its fields, or drop it from one`,
        ],
      );
    }
  }
  return Effect.void;
}

const movesOf = (tag: Tag, field: string): readonly string[] =>
  tag.gates.flatMap((gate) => (gate.gate === 'transition' && gate.field === field ? [`${gate.from} → ${gate.to}`] : [])).sort();

export function assertRequiredFields(
  tags: readonly Tag[],
  fields: Readonly<Record<string, unknown>>,
): Effect.Effect<void, GateRefusal<'field-required'>> {
  for (const tag of tags) {
    for (const gate of tag.gates) {
      if (gate.gate !== 'required' || fields[gate.field] !== undefined) continue;
      return new GateRefusal('field-required', `${tag.id}.${gate.field}: a #${tag.id} carries it`, [
        `write ${tag.id}.${gate.field}: it takes ${spell(tag.fields[gate.field])}`,
      ]);
    }
  }
  return Effect.void;
}

export type FieldSchemaTypes = {
  line: string;
  blockQuery: BlockQuery;
  viewLayout: ViewLayout;
  amendmentOps: readonly AmendmentOp[];
  researchSource: ResearchSource;
  tagFields: Tag['fields'];
  tagEdges: Tag['edges'];
  tagSources: NonNullable<Tag['sources']>;
  tagGates: readonly Gate[];
  tagRoles: Tag['roles'];
  tagBody: BodyShape;
  tagExtends: string;
  tagOpen: readonly Slot[];
  tagSections: readonly Section[];
  tagIdentity: TagIdentity;
  tagContracts: ContractBindings;
  keyedLayer: KeyedLayer;
  typeFork: Fork;
  guidanceFork: GuidanceFork;
  catalogRelease: CatalogRelease;
  catalogProfile: CatalogProfile;
  lawEnforcement: LawEnforcement;
  moduleEntries: ModuleEntries;
  moduleOrder: ModuleOrder;
};

export type FieldHolder = { readonly uuid: string; readonly fields: Readonly<Record<string, unknown>> };

export function readField<N extends FieldSchemaName>(
  node: FieldHolder,
  name: string,
  as: N,
): Effect.Effect<FieldSchemaTypes[N], GateRefusal<'field-invalid'>> {
  const stored = node.fields[name];
  const read = SCHEMA_DECODERS[as](stored);
  if (read._tag === 'Failure') {
    return new GateRefusal('field-invalid', `${blockName(node.uuid)}.${name}: ${read.failure.message}`, [
      `${name} takes ${as}: ${fieldForm(as)}`,
    ]);
  }
  return Effect.succeed(read.success as FieldSchemaTypes[N]);
}

export function readFieldOption<N extends FieldSchemaName>(
  node: FieldHolder,
  name: string,
  as: N,
): Effect.Effect<FieldSchemaTypes[N] | undefined, GateRefusal<'field-invalid'>> {
  return node.fields[name] === undefined ? Effect.succeed(undefined) : readField(node, name, as);
}

export function tagNodeFields(declared: Tag): Record<string, unknown> {
  return {
    id: declared.id,
    fields: declared.fields,
    edges: declared.edges,
    ...(declared.sources === undefined ? {} : { sources: declared.sources }),
    gates: declared.gates,
    roles: declared.roles,
    body: declared.body,
    ...(declared.extends === undefined ? {} : { extends: declared.extends }),
    ...(declared.open === undefined ? {} : { open: declared.open }),
    ...(declared.sections === undefined ? {} : { sections: declared.sections }),
    ...(declared.contracts === undefined ? {} : { contracts: declared.contracts }),
  };
}

export type DeclarationNode = { readonly fields: Readonly<Record<string, unknown>>; readonly body: string };

export class DeclarationUnreadable extends Data.TaggedError('DeclarationUnreadable')<{
  readonly declaration: Declaration;
  readonly message: string;
}> {}

export const declarationId = (node: DeclarationNode): string => (typeof node.fields.id === 'string' ? node.fields.id : '');

export function declarationOf(node: DeclarationNode): Result.Result<Declaration, DeclarationUnreadable> {
  const declaration: Declaration = { id: declarationId(node), prompt: node.body };
  const unread = new Map<string, string>();
  for (const [name, as] of DECLARATION_PARTS) {
    if (node.fields[name] === undefined || TAG_DECLARATION.fields[name] === undefined) continue;
    const read = SCHEMA_DECODERS[as](node.fields[name]);
    if (Result.isFailure(read)) unread.set(name, read.failure.message);
    else Object.assign(declaration, { [name]: read.success });
  }
  if (unread.size === 0) return Result.succeed(declaration);
  return Result.fail(
    new DeclarationUnreadable({
      declaration,
      message: `the declaration cannot be read: ${[...unread].map(([name, reason]) => `${name}: ${reason}`).join('; ')}`,
    }),
  );
}

const DECLARATION_PARTS = [
  ['extends', 'tagExtends'],
  ['fields', 'tagFields'],
  ['edges', 'tagEdges'],
  ['sources', 'tagSources'],
  ['gates', 'tagGates'],
  ['roles', 'tagRoles'],
  ['body', 'tagBody'],
  ['open', 'tagOpen'],
  ['sections', 'tagSections'],
  ['contracts', 'tagContracts'],
] as const satisfies readonly (readonly [string, FieldSchemaName])[];

export function candidateOf(row: FieldHolder & DeclarationNode): Candidate {
  const name = blockName(row.uuid);
  return Result.match(declarationOf(row), {
    onSuccess: (declaration) => ({ name, declaration, unread: null }),
    onFailure: (failure) => ({ name, declaration: failure.declaration, unread: failure.message }),
  });
}

export function incoherence(declared: Tag): GateRefusal<'tag-incoherent'> | null {
  const named = `#${declared.id}`;
  for (const role of ROLES) {
    const bound = declared.roles[role];
    if (typeof bound !== 'string') continue;
    if (declared.fields[bound] === undefined) {
      return new GateRefusal('tag-incoherent', `${named}.roles.${role} names "${bound}", which ${named} does not declare`, [
        `declare ${named}.fields.${bound}, or bind ${role} to a field it has: ${Object.keys(declared.fields).join(', ') || 'none'}`,
        `bind it to true instead, where carrying ${named} is the whole of the role`,
      ]);
    }
  }
  const binding = declared.roles.status;
  const status = fieldName(declared, 'status');
  if (binding !== undefined && statusWords(declared).length === 0) {
    return new GateRefusal('tag-incoherent', `${named}.roles.status names "${binding.field}", which holds no words`, [
      `declare ${named}.fields.${binding.field} as {type: "enum", values: [...]} — a status is a fixed set of words`,
    ]);
  }
  const ends = terminalStatuses(declared);
  if (binding !== undefined) {
    const words = statusWords(declared);
    const meanings = [
      { meaning: 'initial', word: binding.initial, ends: false },
      ...(binding.claimed === undefined ? [] : [{ meaning: 'claimed', word: binding.claimed, ends: false }]),
      ...(binding.done === undefined ? [] : [{ meaning: 'done', word: binding.done, ends: true }]),
      ...(binding.closed === undefined ? [] : [{ meaning: 'closed', word: binding.closed, ends: true }]),
    ];
    for (const { meaning, word, ends: terminal } of meanings) {
      if (!words.includes(word)) {
        return new GateRefusal(
          'tag-incoherent',
          `${named}.roles.status.${meaning} names "${word}", which ${named}.fields.${binding.field} does not hold`,
          [`name one of ${words.join(', ')}, or declare "${word}" among the values of ${named}.fields.${binding.field}`],
        );
      }
      if (terminal && statusTargets(declared, word).some((to) => to !== binding.initial)) {
        return new GateRefusal(
          'tag-incoherent',
          `${named}.roles.status.${meaning} names "${word}", which ${named} moves out of to something other than its initial word`,
          [
            `drop the transitions out of "${word}" except the one back to "${binding.initial}": an ending is a word work stops at, or is reopened from`,
          ],
        );
      }
      if (!terminal && ends.includes(word)) {
        return new GateRefusal(
          'tag-incoherent',
          `${named}.roles.status.${meaning} names "${word}", which ${named} declares no move out of`,
          [`add a transition out of "${word}": work standing there could never move again`],
        );
      }
    }
    if (binding.done !== undefined && binding.done === binding.closed) {
      return new GateRefusal('tag-incoherent', `${named} spells done and closed with one word, "${binding.done}"`, [
        'name two: the distinction between work that happened and work that was dropped is the whole of what an ending says',
      ]);
    }
  }
  if (declared.roles.work !== undefined && status === null) {
    return new GateRefusal('tag-incoherent', `${named} binds the work role and declares no status`, [
      `bind ${named}.roles.status to an enum field: work is where it GOT TO, and a tag with no word for that enters no frontier and is never taken`,
      `drop the work role, if a ${named} is not a thing anybody works`,
    ]);
  }
  if (declared.roles.work !== undefined && (binding?.done === undefined || binding.closed === undefined)) {
    return new GateRefusal('tag-incoherent', `${named} reports work and names no ${binding?.done === undefined ? 'done' : 'closed'} word`, [
      `name both: ${named}.roles.status.done is where work that HAPPENED lands, .closed where work decided against lands`,
      `the endings this tag declares are ${ends.join(', ') || 'none — a word with no move out of it is one'}`,
      `drop the work role, if a ${named} is not a thing that can be finished or dropped`,
    ]);
  }
  const verdicts = declared.roles.amendment;
  if (verdicts !== undefined) {
    if (binding === undefined) {
      return new GateRefusal('tag-incoherent', `${named} binds the amendment role and declares no status`, [
        `bind ${named}.roles.status: a verdict is an ending, and a tag with no status has nowhere to record one`,
      ]);
    }
    const words = statusWords(declared);
    for (const verdict of AMENDMENT_VERDICTS) {
      const word = verdicts[verdict];
      if (!words.includes(word) || !ends.includes(word)) {
        return new GateRefusal(
          'tag-incoherent',
          `${named}.roles.amendment.${verdict} names "${word}", which is not an ending of ${named}.fields.${binding.field}`,
          [`name one of ${ends.join(', ') || 'this tag declares none'} — a verdict is where a finding stops`],
        );
      }
    }
    const ops = declared.fields[verdicts.field];
    if (typeof ops !== 'object' || ops.type !== 'schema' || ops.name !== 'amendmentOps') {
      return new GateRefusal(
        'tag-incoherent',
        `${named}.roles.amendment.field names "${verdicts.field}", which does not hold the operations a verdict runs`,
        [`declare ${named}.fields.${verdicts.field} as {type: "schema", name: "amendmentOps"}`],
      );
    }
    const generic = binding.done ?? binding.closed;
    if (generic !== undefined) {
      return new GateRefusal(
        'tag-incoherent',
        `${named} ends on a verdict and also names "${generic}" for the generic ${binding.done === undefined ? 'close' : 'finish'}`,
        [
          `drop ${named}.roles.status.${binding.done === undefined ? 'closed' : 'done'}: an amendment ends on run, declined or answered and on nothing else`,
          `drop ${named}.roles.amendment, if a ${named} is not a finding somebody judges`,
        ],
      );
    }
  }
  if (fieldName(declared, 'delivery') !== null && fieldName(declared, 'law') === null) {
    return new GateRefusal('tag-incoherent', `${named} binds the delivery role and not the law role`, [
      `bind ${named}.roles.law as well: delivery says where a law reaches agents, and only law is delivered`,
      `drop ${named}.roles.delivery, if a ${named} is not a norm anybody is held to`,
    ]);
  }
  const enforcement = fieldName(declared, 'enforcement');
  if (enforcement !== null) {
    if (fieldName(declared, 'law') === null) {
      return new GateRefusal('tag-incoherent', `${named} binds the enforcement role and not the law role`, [
        `bind ${named}.roles.law as well: an enforced rule is delivered to every thread it binds, and only law is delivered`,
        `drop ${named}.roles.enforcement, if a ${named} is not a norm anybody is held to`,
      ]);
    }
    const document = declared.fields[enforcement];
    if (typeof document !== 'object' || document.type !== 'schema' || document.name !== 'lawEnforcement') {
      return new GateRefusal(
        'tag-incoherent',
        `${named}.roles.enforcement names "${enforcement}", which does not hold an enforcement document`,
        [`declare ${named}.fields.${enforcement} as {type: "schema", name: "lawEnforcement"}`],
      );
    }
  }
  const holder = fieldName(declared, 'holder');
  if (holder !== null && declared.fields[holder] !== 'session') {
    return new GateRefusal('tag-incoherent', `${named}.roles.holder names "${holder}", which does not hold a session`, [
      `declare ${named}.fields.${holder} as "session": a holder is the session a claim compares against`,
    ]);
  }
  for (const gate of declared.gates) {
    const field = gate.gate === 'transition' || gate.gate === 'required' ? gate.field : null;
    if (field !== null && declared.fields[field] === undefined) {
      return new GateRefusal('tag-incoherent', `${named} gates "${field}", which ${named} does not declare`, [
        `declare ${named}.fields.${field}, or drop the ${gate.gate} gate over it`,
      ]);
    }
  }
  return null;
}
