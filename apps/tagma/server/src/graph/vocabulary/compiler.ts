import { Result } from 'effect';
import { canonicalJson } from '@runlith/utils/object';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import {
  type BodyShape,
  CATALOG_DECLARATION,
  type Declaration,
  edgeKindOf,
  type FieldType,
  type Gate,
  ROLES,
  type Role,
  type Slot,
  SLOTS,
  type Tag,
  TAG_DECLARATION,
  TAG_DEFAULTS,
  type TagFields,
  type TagRoles,
} from '../contract/wire/tags/declaration.js';
import type { DeclaringNode, Redeclared, UnreadableTag } from '../contract/wire/tags/table.js';
import type { Provenance, SectionSource } from '../contract/wire/tags/provenance.js';
import type { Section, SectionOrigin } from '../contract/wire/tags/sections.js';
import { LIFECYCLE, lifecycleOf } from '../contract/wire/tags/lifecycle.js';
import type { Bound, ContractBinding, ContractBindings } from '../contract/wire/tags/behaviour.js';
import { VOCABULARY_FORMAT } from '../contract/wire/tags/revision.js';
import type { BehaviourRegistry } from '../contract/service/behaviours.js';
import { incoherence } from './declarationRules.js';
import { type BindingPart, bindContracts, translateRoles } from './behaviours.js';

export type TypeResolver = (reference: string) => string | null;

export const SECTION_JOIN = '\n\n';

export type Stated = {
  readonly name: string;
  readonly declaration: Declaration;
  readonly layered?: Readonly<Record<string, SectionOrigin>>;
};

export type Compiled = Stated & {
  readonly tag: Tag;
  readonly lineage: readonly string[];
  readonly provenance: Provenance;
};

export type Candidate = Stated & { readonly unread: string | null };

export type Outcome =
  | { readonly kind: 'compiled'; readonly compiled: Compiled }
  | { readonly kind: 'duplicate'; readonly unreadable: UnreadableTag }
  | { readonly kind: 'refused'; readonly unreadable: UnreadableTag; readonly unblock?: Unblock };

type Composed = Result.Result<Compiled, GateRefusal<'tag-incoherent'>>;

const CORE: ReadonlySet<string> = new Set([TAG_DECLARATION.id, CATALOG_DECLARATION.id]);

//! a refusal names a handful of parents; read_tags lists the whole vocabulary
const PARENTS_NAMED = 12;

const same = (one: unknown, other: unknown): boolean => canonicalJson(one) === canonicalJson(other);

function refuse(reason: string, unblock: Unblock): Composed {
  return Result.fail(new GateRefusal('tag-incoherent', reason, unblock));
}

function origins<K extends string>(keys: Iterable<K>, from: string): Record<K, string> {
  const named = {} as Record<K, string>;
  for (const key of keys) named[key] = from;
  return named;
}

export function core(tag: Tag): Compiled {
  return {
    name: `#${tag.id}`,
    declaration: tag,
    tag,
    lineage: [tag.id],
    provenance: {
      fields: origins(Object.keys(tag.fields), tag.id),
      roles: origins(Object.keys(tag.roles) as Role[], tag.id),
      gates: tag.gates.map(() => tag.id),
      edges: origins(tag.edges.map(edgeKindOf), tag.id),
      sources: origins(tag.sources ?? [], tag.id),
      body: tag.id,
      open: origins(SLOTS, tag.id),
      sections: (tag.sections ?? []).map(() => ({ type: tag.id })),
      contracts: origins(Object.keys(tag.contracts ?? {}), tag.id),
    },
  };
}

export const DECLARED_CONTRACTS_FROM = 2;

function contractParts(
  declaration: Declaration,
  fields: TagFields,
  over: Compiled | null,
  behaviours: BehaviourRegistry,
): Result.Result<readonly BindingPart[], GateRefusal<'tag-incoherent'>> {
  const own = declaration.id;
  const translated = translateRoles(declaration.roles ?? {}, fields, behaviours);
  const declared: ContractBindings = declaration.contracts ?? {};
  if (VOCABULARY_FORMAT < DECLARED_CONTRACTS_FROM) {
    for (const [contract, binding] of Object.entries(declared)) {
      if (same(translated[contract as keyof ContractBindings], binding)) continue;
      return Result.fail(
        new GateRefusal(
          'tag-incoherent',
          `#${own}.contracts binds ${contract}, which its roles do not: vocabulary format ${VOCABULARY_FORMAT} binds behaviour through roles`,
          [`bind it through #${own}.roles`, `contracts are declared from vocabulary format ${DECLARED_CONTRACTS_FROM} on`],
        ),
      );
    }
  }
  const inherited = Object.entries(over?.tag.contracts ?? {}).map(([contract, binding]): BindingPart => ({
    from: over?.provenance.contracts[contract] ?? over!.tag.id,
    contracts: { [contract]: binding },
  }));
  return Result.succeed([...inherited, { from: own, contracts: translated }, { from: own, contracts: declared }]);
}

const firstBound = (parts: readonly BindingPart[]): readonly Bound[] => {
  const bound = new Map<string, Bound>();
  for (const { from, contracts } of parts) {
    for (const [contract, binding] of Object.entries(contracts) as [Bound['contract'], ContractBinding][]) {
      if (!bound.has(contract)) bound.set(contract, { contract, binding, from });
    }
  }
  return [...bound.values()];
};

function contracted({ contracts: _standing, ...tag }: Tag, bound: readonly Bound[]): Tag {
  if (bound.length === 0) return tag;
  return { ...tag, contracts: Object.fromEntries(bound.map(({ contract, binding }) => [contract, binding])) as ContractBindings };
}

function checked(
  stated: Stated,
  composed: Tag,
  lineage: readonly string[],
  provenance: Provenance,
  over: Compiled | null,
  behaviours: BehaviourRegistry,
): Composed {
  const parts = contractParts(stated.declaration, composed.fields, over, behaviours);
  if (Result.isFailure(parts)) return Result.fail(parts.failure);
  const bound = bindContracts(parts.success, composed.fields, composed.gates, behaviours);
  const reading = Result.isSuccess(bound) ? bound.success : firstBound(parts.success);
  const tag = contracted(composed, reading);
  const unboundEdge = tag.edges
    .map(edgeKindOf)
    .map((kind) => behaviours.edge(kind))
    .find((edge) => edge !== null && tag.contracts?.[edge.from] === undefined);
  const edgeRefusal =
    unboundEdge === undefined || unboundEdge === null
      ? null
      : new GateRefusal(
          'tag-incoherent',
          `#${tag.id} declares "${unboundEdge.kind}", whose meaning ${unboundEdge.from} owns, without binding that contract`,
          [`bind ${unboundEdge.from} on #${tag.id}, or drop "${unboundEdge.kind}" from its edges`],
        );
  const incoherent = incoherence(tag) ?? (Result.isFailure(bound) ? bound.failure : edgeRefusal);
  if (incoherent === null) {
    const { name, declaration, layered } = stated;
    const contracts = Object.fromEntries(reading.map(({ contract, from }) => [contract, from]));
    return Result.succeed({
      name,
      declaration,
      layered,
      tag,
      lineage,
      provenance: { ...provenance, contracts },
    });
  }
  if (over === null) return Result.fail(incoherent);
  const own = tag.id;
  const inherited = [
    ...new Set(
      [...Object.values(provenance.fields), ...Object.values(provenance.roles), ...provenance.gates].filter((from) => from !== own),
    ),
  ];
  return refuse(`#${own} extends #${over.tag.id}, and what the two compose is incoherent: ${incoherent.reason}`, [
    `drop what #${own} adds over #${over.tag.id}, if the inherited parts are right`,
    `change the inherited part where it is declared — on ${inherited.map((from) => `#${from}`).join(', ')} — if #${own} adds what it should`,
  ]);
}

const joined = (sections: readonly Section[]): string =>
  sections.flatMap((section) => (section.text === '' ? [] : [section.text])).join(SECTION_JOIN);

type Texts = { readonly sections: readonly Section[]; readonly sources: readonly SectionSource[] };

function ownTexts({ declaration, layered }: Stated): Result.Result<Texts | null, GateRefusal<'tag-incoherent'>> {
  if (declaration.sections === undefined) return Result.succeed(null);
  const keys = new Set<string>();
  for (const { key } of declaration.sections) {
    if (keys.has(key)) {
      return Result.fail(
        new GateRefusal('tag-incoherent', `#${declaration.id}.sections names "${key}" twice: a section is found by its key`, [
          `give each section of #${declaration.id} its own key`,
        ]),
      );
    }
    keys.add(key);
  }
  return Result.succeed({
    sections: declaration.sections,
    sources: declaration.sections.map(({ key }) => {
      const origin = layered?.[key];
      return origin === undefined ? { type: declaration.id } : { type: declaration.id, origin };
    }),
  });
}

function rooted(stated: Stated, behaviours: BehaviourRegistry): Composed {
  const { declaration } = stated;
  const texts = ownTexts(stated);
  if (Result.isFailure(texts)) return Result.fail(texts.failure);
  const own = texts.success;
  const { sections: _sections, prompt, ...parts } = declaration;
  const tag: Tag = {
    ...TAG_DEFAULTS,
    ...parts,
    sections: own?.sections,
    prompt: own === null ? prompt : joined(own.sections),
  };
  const provenance = { ...core(tag).provenance, sections: own?.sources ?? [] };
  return checked(stated, tag, [tag.id], provenance, null, behaviours);
}

const machineFields = (tag: Tag): Set<string> => {
  const fields = new Set(tag.gates.flatMap((gate) => (gate.gate === 'transition' ? [gate.field] : [])));
  const status = lifecycleOf(tag)?.field;
  if (status !== undefined) fields.add(status);
  return fields;
};

const movesOver = (gates: readonly Gate[], field: string): Set<string> =>
  new Set(gates.flatMap((gate) => (gate.gate === 'transition' && gate.field === field ? [`${gate.from} → ${gate.to}`] : [])));

function widened<T>(
  slot: Slot,
  stated: readonly T[] | undefined,
  base: readonly T[] | undefined,
  over: Compiled,
  own: string,
  keyOf: (item: T) => string,
): Result.Result<{ readonly kinds: readonly T[] | undefined; readonly from: Record<string, string> }, GateRefusal<'tag-incoherent'>> {
  const standing = base ?? [];
  const standingKeys = new Set(standing.map(keyOf));
  const addedItems = (stated ?? []).filter((item) => !standingKeys.has(keyOf(item)));
  const added = addedItems.map(keyOf);
  const from = { ...(slot === 'edges' ? over.provenance.edges : over.provenance.sources) };
  if (added.length === 0) return Result.succeed({ kinds: base, from });
  if (!(over.tag.open ?? []).includes(slot)) {
    return Result.fail(
      new GateRefusal(
        'tag-incoherent',
        `#${own}.${slot} adds ${added.join(', ')}, and #${over.provenance.open[slot]} keeps the ${slot} of #${over.tag.id} closed: a descendant widens a slot only where its base declared it open`,
        [
          `drop ${added.join(', ')} from #${own}.${slot}: #${own} carries every one #${over.tag.id} allows`,
          `declare open: ["${slot}"] on #${over.provenance.open[slot]}, if every descendant may widen it`,
        ],
      ),
    );
  }
  for (const kind of added) from[kind] = own;
  return Result.succeed({ kinds: [...standing, ...addedItems], from });
}

const verbatim: TypeResolver = (reference) => reference;

const targetOf = (type: FieldType, resolve: TypeResolver): FieldType =>
  typeof type === 'object' && type.type === 'ref' && type.tag !== undefined ? { ...type, tag: resolve(type.tag) ?? type.tag } : type;

const gateOf = (gate: Gate, resolve: TypeResolver): Gate =>
  gate.gate === 'open-children' ? { ...gate, tag: resolve(gate.tag) ?? gate.tag } : gate;

function extended(stated: Stated, over: Compiled, behaviours: BehaviourRegistry, resolve: TypeResolver): Composed {
  const { declaration } = stated;
  const own = declaration.id;
  const base = over.tag;
  const from = over.provenance;

  const fields = { ...base.fields };
  const fieldFrom = { ...from.fields };
  for (const [field, type] of Object.entries(declaration.fields ?? {})) {
    const standing = base.fields[field];
    if (standing === undefined) {
      fields[field] = type;
      fieldFrom[field] = own;
    } else if (!same(targetOf(standing, resolve), targetOf(type, resolve))) {
      return refuse(
        `#${own}.fields.${field} declares "${field}" as another type than #${from.fields[field]} does: a descendant keeps every field it inherits`,
        [
          `write #${own}.fields.${field} as #${from.fields[field]} declares it, or drop it and inherit it`,
          `name the field of #${own} another way`,
        ],
      );
    }
  }

  const roles: Record<string, unknown> = { ...base.roles };
  const roleFrom: Partial<Record<Role, string>> = { ...from.roles };
  for (const role of ROLES) {
    const bound = declaration.roles?.[role];
    if (bound === undefined) continue;
    const standing = base.roles[role];
    if (standing === undefined) {
      roles[role] = bound;
      roleFrom[role] = own;
    } else if (!same(standing, bound)) {
      return refuse(
        `#${own}.roles.${role} binds the ${role} #${from.roles[role]} already binds another way: one state has one binding owner, and two machines over it would leave each verb reading one of them`,
        [
          `drop #${own}.roles.${role} and inherit the binding of #${from.roles[role]}`,
          `declare #${own} without extends #${base.id}, if it runs a machine of its own`,
        ],
      );
    }
  }

  const machines = machineFields(base);
  const gates = [...base.gates];
  const gateFrom = [...from.gates];
  for (const field of new Set((declaration.gates ?? []).flatMap((gate) => (gate.gate === 'transition' ? [gate.field] : [])))) {
    if (!machines.has(field)) continue;
    const owner =
      from.gates[base.gates.findIndex((gate) => gate.gate === 'transition' && gate.field === field)] ??
      from.contracts[LIFECYCLE] ??
      base.id;
    const standing = movesOver(base.gates, field);
    const moves = movesOver(declaration.gates ?? [], field);
    const added = [...moves].filter((move) => !standing.has(move));
    const dropped = [...standing].filter((move) => !moves.has(move));
    if (added.length > 0 || dropped.length > 0) {
      return refuse(
        `#${own} declares transitions over "${field}", whose lifecycle #${owner} owns, and not as the same machine${added.length === 0 ? '' : `: it adds ${added.join(', ')}`}${dropped.length === 0 ? '' : `${added.length === 0 ? ':' : ' and'} it drops ${dropped.join(', ')}`}. A lifecycle is checked whole; a union of two would let one machine's moves skip the other's gates`,
        [
          `drop the transitions over "${field}" from #${own}: it inherits the lifecycle of #${owner} whole`,
          `declare #${own} without extends #${base.id}, if it runs a lifecycle of its own`,
        ],
      );
    }
  }
  const held = new Set(gates.map((gate) => canonicalJson(gateOf(gate, resolve))));
  for (const gate of declaration.gates ?? []) {
    if (gate.gate === 'transition' && machines.has(gate.field)) continue;
    const key = canonicalJson(gateOf(gate, resolve));
    if (held.has(key)) continue;
    held.add(key);
    gates.push(gate);
    gateFrom.push(own);
  }

  const edges = widened('edges', declaration.edges, base.edges, over, own, edgeKindOf);
  if (Result.isFailure(edges)) return Result.fail(edges.failure);
  const sources = widened('sources', declaration.sources, base.sources, over, own, (kind) => kind);
  if (Result.isFailure(sources)) return Result.fail(sources.failure);

  const open = declaration.open ?? base.open;
  const opened = (declaration.open ?? []).filter((slot) => !(base.open ?? []).includes(slot));
  if (opened.length > 0) {
    const owners = [...new Set(opened.map((slot) => from.open[slot]))];
    return refuse(
      `#${own}.open opens ${opened.join(', ')}, which #${owners.join(', #')} keeps closed: a descendant cannot open what its base closed`,
      [
        `drop ${opened.join(', ')} from #${own}.open`,
        ...opened.map((slot) => `declare open: ["${slot}"] on #${from.open[slot]}, if every descendant may widen it`),
      ],
    );
  }
  const openFrom = { ...from.open };
  for (const slot of SLOTS) {
    if ((base.open ?? []).includes(slot) && !(open ?? []).includes(slot)) openFrom[slot] = own;
  }

  let body: BodyShape = base.body;
  let bodyFrom = from.body;
  if (declaration.body !== undefined) {
    if (declaration.body.shape !== base.body.shape) {
      return refuse(
        `#${own}.body is ${declaration.body.shape}, and #${from.body} gives #${base.id} a ${base.body.shape} body: a body has one shape`,
        [
          `drop #${own}.body and inherit the ${base.body.shape} shape`,
          `write #${own}.body as ${base.body.shape}, with a cap tighter than the one it inherits if it needs one`,
        ],
      );
    }
    const caps = [base.body.cap, declaration.body.cap].filter((cap): cap is number => cap !== undefined);
    const cap = caps.length === 0 ? undefined : Math.min(...caps);
    if (cap !== base.body.cap) {
      body = { shape: base.body.shape, cap };
      bodyFrom = own;
    }
  }

  const texts = ownTexts(stated);
  if (Result.isFailure(texts)) return Result.fail(texts.failure);
  const ownSections = texts.success ?? { sections: [{ key: own, text: declaration.prompt }], sources: [{ type: own }] };
  const sections = [...(base.sections ?? [{ key: base.id, text: base.prompt }]), ...ownSections.sections];

  const tag: Tag = {
    id: own,
    extends: base.id,
    fields,
    edges: edges.success.kinds ?? [],
    sources: sources.success.kinds,
    gates,
    roles: roles as TagRoles,
    body,
    open,
    sections,
    prompt: joined(sections),
  };
  const provenance: Provenance = {
    fields: fieldFrom,
    roles: roleFrom,
    gates: gateFrom,
    edges: edges.success.from,
    sources: sources.success.from,
    body: bodyFrom,
    open: openFrom,
    sections: [...(base.sections === undefined ? [{ type: base.id }] : from.sections), ...ownSections.sources],
    contracts: from.contracts,
  };
  return checked(stated, tag, [...over.lineage, own], provenance, over, behaviours);
}

export function compose(stated: Stated, over: Compiled | null, behaviours: BehaviourRegistry, resolve: TypeResolver = verbatim): Composed {
  return over === null ? rooted(stated, behaviours) : extended(stated, over, behaviours, resolve);
}

export const declaredOnly =
  (ids: ReadonlySet<string>): TypeResolver =>
  (reference) =>
    ids.has(reference) ? reference : null;

const targetsAt = new WeakMap<Compiled, string>();

const targetsOf = ({ fields, gates }: Declaration, resolve: TypeResolver): string =>
  canonicalJson([Object.values(fields ?? {}).map((type) => targetOf(type, resolve)), (gates ?? []).map((gate) => gateOf(gate, resolve))]);

const keeps = (
  prior: Compiled | undefined,
  candidate: Candidate,
  over: Compiled | null,
  before: ReadonlyMap<string, Compiled>,
  resolve: TypeResolver,
): prior is Compiled =>
  prior !== undefined &&
  prior.name === candidate.name &&
  targetsAt.get(prior) === targetsOf(candidate.declaration, resolve) &&
  (over === null ? prior.tag.extends === undefined : prior.tag.extends === over.tag.id && before.get(over.tag.id) === over) &&
  same(prior.declaration, candidate.declaration) &&
  same(prior.layered ?? null, candidate.layered ?? null);

export function compileVocabulary(
  candidates: readonly Candidate[],
  behaviours: BehaviourRegistry,
  resolver?: TypeResolver,
  prior: ReadonlyMap<string, Compiled> = new Map(),
): readonly Outcome[] {
  const outcomes: (Outcome | undefined)[] = new Array(candidates.length);
  const byId = new Map<string, number[]>();
  const unreadable = (at: number, reason: string, kind: 'duplicate' | 'refused' = 'refused'): void => {
    const { name, declaration } = candidates[at]!;
    outcomes[at] = { kind, unreadable: { name, id: declaration.id, reason } };
  };
  candidates.forEach(({ declaration }, at) => {
    if (declaration.id === '') unreadable(at, 'it declares no id');
    else if (CORE.has(declaration.id)) unreadable(at, `#${declaration.id} is already declared`, 'duplicate');
    else {
      const bucket = byId.get(declaration.id);
      if (bucket === undefined) byId.set(declaration.id, [at]);
      else bucket.push(at);
    }
  });
  const resolve = resolver ?? declaredOnly(new Set(byId.keys()));
  const winners = new Map<string, Compiled | null>();
  const visiting = new Set<string>();

  const compileId = (id: string): Compiled | null => {
    const known = winners.get(id);
    if (known !== undefined) return known;
    visiting.add(id);
    let winner: Compiled | null = null;
    for (const at of byId.get(id) ?? []) {
      const candidate = candidates[at]!;
      const { name, declaration, unread } = candidate;
      if (winner !== null) {
        unreadable(at, `#${id} is already declared`, 'duplicate');
        continue;
      }
      if (unread !== null) {
        unreadable(at, unread);
        continue;
      }
      let over: Compiled | null = null;
      if (declaration.extends !== undefined) {
        const key = resolve(declaration.extends);
        if (key === null || CORE.has(key)) {
          unreadable(at, `it extends #${declaration.extends}, which this project declares no type of its own under`);
          continue;
        }
        if (visiting.has(key)) {
          unreadable(at, `its extends chain returns to #${key}`);
          continue;
        }
        over = compileId(key);
        if (over === null) {
          unreadable(at, `it extends #${key}, which stands unreadable`);
          continue;
        }
      }
      const kept = prior.get(id);
      if (keeps(kept, candidate, over, prior, resolve)) {
        winner = kept;
        outcomes[at] = { kind: 'compiled', compiled: kept };
        continue;
      }
      const composed = compose(candidate, over, behaviours, resolve);
      if (Result.isFailure(composed)) {
        outcomes[at] = {
          kind: 'refused',
          unreadable: { name, id, reason: composed.failure.reason },
          unblock: composed.failure.unblock,
        };
        continue;
      }
      winner = composed.success;
      targetsAt.set(winner, targetsOf(declaration, resolve));
      outcomes[at] = { kind: 'compiled', compiled: winner };
    }
    visiting.delete(id);
    winners.set(id, winner);
    return winner;
  };

  for (const id of byId.keys()) compileId(id);
  return outcomes as readonly Outcome[];
}

export type Standing = {
  readonly types: ReadonlyMap<string, Compiled>;
  readonly resolve: TypeResolver;
  readonly behaviours: BehaviourRegistry;
  descendantsOf(id: string): readonly string[];
};

const schemaOf = ({ prompt: _prompt, sections: _sections, ...schema }: Tag) => schema;

export const sameSchema = (one: Tag, other: Tag): boolean => same(schemaOf(one), schemaOf(other));

export function recompile(
  standing: Standing,
  declaration: Declaration,
  replacing: DeclaringNode | null,
): Result.Result<readonly Redeclared[], GateRefusal<'tag-incoherent'>> {
  const name = replacing?.name ?? `#${declaration.id}`;
  const was = replacing === null ? undefined : standing.types.get(replacing.id);
  const replaced = was !== undefined && was.name === replacing?.name ? was : undefined;
  const below = replaced === undefined ? [] : standing.descendantsOf(replaced.tag.id);
  let over: Compiled | null = null;
  if (declaration.extends !== undefined) {
    const key = standing.resolve(declaration.extends);
    const parent = key === null ? undefined : standing.types.get(key);
    if (key !== null && parent === undefined && !CORE.has(key)) {
      return Result.fail(
        new GateRefusal('tag-incoherent', `#${declaration.id} extends #${key}, which stands unreadable`, [
          `read_tags names why #${key} cannot be read: correct it first`,
          'name another standing type in extends, or drop extends',
        ]),
      );
    }
    if (
      key === null ||
      parent === undefined ||
      CORE.has(key) ||
      (replaced !== undefined && key === replaced.tag.id && key !== declaration.id)
    ) {
      const eligible = [...standing.types.keys()].filter(
        (type) => !CORE.has(type) && type !== declaration.id && type !== replaced?.tag.id && !below.includes(type),
      );
      return Result.fail(
        new GateRefusal(
          'tag-incoherent',
          `#${declaration.id} extends #${declaration.extends}, which this project declares no type of its own under`,
          [
            eligible.length === 0
              ? 'this project declares no type it could extend'
              : `name a standing type in extends: ${eligible.slice(0, PARENTS_NAMED).join(', ')}${eligible.length > PARENTS_NAMED ? ` and ${eligible.length - PARENTS_NAMED} more` : ''}`,
            'drop extends, if this type stands on its own',
          ],
        ),
      );
    }
    if (key === declaration.id || below.includes(key)) {
      return Result.fail(
        new GateRefusal(
          'tag-incoherent',
          `#${declaration.id} extends #${key}, which already descends from it: a type cannot be its own ancestor`,
          [`name a type outside the descendants of #${declaration.id} in extends`],
        ),
      );
    }
    over = parent;
  }
  const layered = replaced?.layered;
  const composed = compose(
    layered === undefined ? { name, declaration } : { name, declaration, layered },
    over,
    standing.behaviours,
    standing.resolve,
  );
  if (Result.isFailure(composed)) return Result.fail(composed.failure);
  const next = new Map<string, Compiled>([[declaration.id, composed.success]]);
  const changes: Redeclared[] = [{ type: replacing?.id ?? declaration.id, was: replaced?.tag ?? null, now: composed.success.tag }];
  if (replaced !== undefined && replaced.tag.id === declaration.id && same(replaced.tag, composed.success.tag))
    return Result.succeed(changes);
  for (const id of below) {
    const child = standing.types.get(id);
    if (child === undefined || child.declaration.extends === undefined) continue;
    const key = standing.resolve(child.declaration.extends);
    if (key !== null && key === replaced?.tag.id && declaration.id !== key) {
      return Result.fail(
        new GateRefusal('tag-incoherent', `#${id} extends #${key}, which this write would leave undeclared`, [
          `keep the id "${key}": #${id} names it in extends`,
          `point #${id} at another type first`,
        ]),
      );
    }
    const parent = key === null ? undefined : (next.get(key) ?? standing.types.get(key));
    if (parent === undefined) continue;
    const recomposed = compose(child, parent, standing.behaviours, standing.resolve);
    if (Result.isFailure(recomposed)) {
      return Result.fail(
        new GateRefusal(
          'tag-incoherent',
          `#${id} descends from #${declaration.id}, and would no longer compose over it: ${recomposed.failure.reason}`,
          [`correct #${id} first, or write #${declaration.id} so #${id} still composes over it`, ...recomposed.failure.unblock],
        ),
      );
    }
    next.set(id, recomposed.success);
    changes.push({ type: id, was: child.tag, now: recomposed.success.tag });
  }
  return Result.succeed(changes);
}
