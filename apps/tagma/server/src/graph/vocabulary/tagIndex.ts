import { type StatusPhase, type TagWords, terminalStatuses } from '../contract/wire/tags/roles.js';
import { TagReader } from '../contract/wire/tags/reading.js';
import { Effect, Result } from 'effect';
import { canonicalJson } from '@runlith/utils/object';
import { sha256 } from '@runlith/utils/sha256';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CATALOG_DECLARATION, type Declaration, type Tag, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { type LawProjection, projectLaw } from '../contract/wire/tags/law.js';
import { VOCABULARY_FORMAT, type VocabularyRevision } from '../contract/wire/tags/revision.js';
import type { DeclaringNode, Redeclared, SlotField, TagTable, UnreadableTag } from '../contract/wire/tags/table.js';
import { NO_ACTIONS, type NodeActions, type TagActions } from '../contract/wire/tags/actions.js';
import { projectActions } from './actions.js';
import { LIFECYCLE, lifecycleOf } from '../contract/wire/tags/lifecycle.js';

import type { Provenance } from '../contract/wire/tags/provenance.js';
import {
  type Candidate,
  type Compiled,
  compileVocabulary,
  core,
  DECLARED_CONTRACTS_FROM,
  recompile,
  type TypeResolver,
} from './compiler.js';
import type { BehaviourRegistry } from '../contract/service/behaviours.js';
import { type Catalogs, NO_CATALOGS } from '../contract/wire/catalogs.js';
import { catalogUnblock } from './available.js';
import { Identities, NO_NAMING, type Naming } from './identity.js';
import {
  type CatalogProfile,
  type CreationDefault,
  type CreationDefaultRefusal,
  codeChecksOf,
  creationType,
} from '../contract/wire/tags/profile.js';
import type { BehaviourEdge, ContractBinding, ContractId, EdgeMeaning } from '../contract/wire/tags/behaviour.js';

const CORE_TYPES = [core(TAG_DECLARATION), core(CATALOG_DECLARATION)];

const isCompiled = (entry: Declaration | Candidate | Compiled): entry is Compiled => 'tag' in entry && 'lineage' in entry;

const isCandidate = (entry: Declaration | Candidate): entry is Candidate => 'declaration' in entry;

export class TagIndex extends TagReader implements TagTable {
  readonly unreadable: readonly UnreadableTag[];
  readonly identities: Identities;
  private readonly compiled: ReadonlyMap<string, Compiled>;
  private readonly children: ReadonlyMap<string, readonly string[]>;
  private readonly resolve: TypeResolver;
  private readonly byId: ReadonlyMap<string, Tag>;
  private readonly slotIndex = new Map<string, readonly SlotField[]>();
  private readonly wordIndex = new Map<string, readonly TagWords[]>();
  private readonly profiles: readonly CatalogProfile[];
  private readonly defaults: ReadonlyMap<ContractId, Effect.Effect<Tag, GateRefusal<CreationDefaultRefusal>>>;
  private readonly profileFailure: GateRefusal<'creation-default-invalid'> | null;
  private readonly laws: ReadonlyMap<string, LawProjection>;
  private readonly lawTypes: readonly string[];
  private readonly byContract: ReadonlyMap<ContractId, readonly string[]>;
  private readonly acting = new Map<string, TagActions>();
  private readonly nodes = new Map<string, NodeActions>();
  private revised: VocabularyRevision | null = null;

  constructor(
    declared: readonly (Declaration | Candidate | Compiled)[],
    private readonly behaviours: BehaviourRegistry,
    unreadable: readonly UnreadableTag[] = [],
    naming: Naming = NO_NAMING,
    prior: TagIndex | null = null,
    private readonly catalogs: Catalogs['Service'] = NO_CATALOGS,
  ) {
    super();
    const given = declared.filter(isCompiled).filter(({ tag }) => tag.id !== TAG_DECLARATION.id && tag.id !== CATALOG_DECLARATION.id);
    const candidates = declared.flatMap((entry): Candidate[] =>
      isCompiled(entry)
        ? []
        : isCandidate(entry)
          ? [entry]
          : entry.id === TAG_DECLARATION.id || entry.id === CATALOG_DECLARATION.id
            ? []
            : [{ name: `#${entry.id}`, declaration: entry, unread: null }],
    );
    const identitiesOf = (standing: readonly { readonly name: string; readonly declaration: Declaration }[]): Identities =>
      new Identities(
        CORE_TYPES.map((type) => type.tag.id),
        standing.flatMap(({ name, declaration }) => {
          const named = naming.declarations.get(name);
          return declaration.id === ''
            ? []
            : [{ key: declaration.id, declaration: name, uuid: named?.uuid ?? name, identity: named?.identity ?? null }];
        }),
        naming.releases,
        {
          fieldsOf: (type) => Object.keys(this.compiled.get(type)?.tag.fields ?? {}),
          originOf: (type, field) => this.compiled.get(type)?.provenance.fields[field] ?? null,
        },
      );
    const readable = identitiesOf([...given, ...candidates.filter((candidate) => candidate.unread === null)]);
    const outcomes = compileVocabulary(
      candidates,
      behaviours,
      (word) => readable.resolveStoredType(word),
      prior?.behaviours === behaviours ? prior.compiled : undefined,
    );
    const winners = [...given, ...outcomes.flatMap((outcome) => (outcome.kind === 'compiled' ? [outcome.compiled] : []))];
    const identities = identitiesOf(winners);
    this.identities = identities;
    this.profiles = naming.profiles;
    this.profileFailure =
      naming.profileErrors.length === 0
        ? null
        : new GateRefusal('creation-default-invalid', `installed catalog profiles cannot be read: ${naming.profileErrors.join('; ')}`, [
            'repair the recorded catalog profiles before selecting a creation default',
          ]);
    const defaults = new Map<ContractId, CreationDefault[]>();
    for (const profile of naming.profiles) {
      for (const entry of profile.defaults ?? []) {
        const entries = defaults.get(entry.contract);
        if (entries === undefined) defaults.set(entry.contract, [entry]);
        else entries.push(entry);
      }
    }
    this.resolve = (word) => identities.resolveStoredType(word);
    const types = [...CORE_TYPES, ...winners];
    this.unreadable = [
      ...unreadable,
      ...outcomes.flatMap((outcome) => (outcome.kind === 'compiled' ? [] : [outcome.unreadable])),
      ...identities.collisions.map((word) => ({
        name: identities.typeOf(word)?.declaration ?? word,
        id: word,
        reason: `"${word}" is both a stored key and a permanent id, so a reference spelling it names no type`,
      })),
    ];
    this.compiled = new Map(types.map((type) => [type.tag.id, type] as const));
    const children = new Map<string, string[]>();
    for (const { tag } of types) {
      if (tag.extends === undefined) continue;
      const siblings = children.get(tag.extends);
      if (siblings === undefined) children.set(tag.extends, [tag.id]);
      else siblings.push(tag.id);
    }
    this.children = children;
    const tags = types.map((type) => {
      const name = identities.typeOf(type.tag.id)?.name;
      return name === undefined || name === type.tag.id ? type.tag : { ...type.tag, name };
    });
    this.byId = new Map(tags.map((tag) => [tag.id, tag] as const));
    const support = new Map<ContractId, string[]>();
    for (const tag of tags) {
      for (const contract of Object.keys(tag.contracts ?? {}) as ContractId[]) {
        const members = support.get(contract);
        if (members === undefined) support.set(contract, [tag.id]);
        else members.push(tag.id);
      }
    }
    this.byContract = support;
    this.laws = new Map(
      tags.flatMap((tag) => {
        const projection = projectLaw(tag);
        return projection === null ? [] : [[tag.id, projection] as const];
      }),
    );
    this.lawTypes = [...this.laws.keys()];
    this.defaults = new Map([...defaults].map(([contract, entries]) => [contract, creationType(this, contract, entries)]));
  }

  get contracts(): readonly ContractId[] {
    return this.behaviours.contracts;
  }

  actionsOf(tagId: string): TagActions {
    let actions = this.acting.get(tagId);
    if (actions === undefined) {
      const tag = this.byId.get(tagId);
      actions = tag === undefined ? NO_ACTIONS : projectActions(tag, this.behaviours);
      this.acting.set(tagId, actions);
    }
    return actions;
  }

  actionsOn(node: { readonly tags: readonly string[] }): NodeActions {
    const tags = this.tagsOf(node);
    const key = tags.map((tag) => tag.id).join('\u0000');
    let projected = this.nodes.get(key);
    if (projected === undefined) {
      let actions: TagActions;
      if (tags.length <= 1) actions = tags.length === 0 ? NO_ACTIONS : this.actionsOf(tags[0]!.id);
      else {
        const contracts: Record<ContractId, ContractBinding> = {};
        for (const tag of tags) {
          for (const [contract, binding] of Object.entries(tag.contracts ?? {}) as [ContractId, ContractBinding][])
            contracts[contract] ??= binding;
        }
        actions = projectActions(this.bindingTag(node, LIFECYCLE) ?? tags[0]!, this.behaviours, contracts);
      }
      projected = { ...actions, revision: this.revision().revision };
      this.nodes.set(key, projected);
    }
    return projected;
  }

  edgeRule(kind: string): BehaviourEdge | null {
    return this.behaviours.edge(kind);
  }

  semanticEdges(meaning: EdgeMeaning): readonly BehaviourEdge[] {
    return this.behaviours.edges.filter((edge) => edge.meaning === meaning);
  }

  typesSupporting(contract: ContractId): readonly string[] {
    return this.byContract.get(contract) ?? [];
  }

  get tags(): Tag[] {
    return [...this.byId.values()];
  }

  bindsCode(): boolean {
    return codeChecksOf(this.profiles);
  }

  creationType(contract: ContractId): Effect.Effect<Tag, GateRefusal<CreationDefaultRefusal>> {
    return (
      this.profileFailure ??
      this.defaults.get(contract) ??
      creationType(this, contract, [], catalogUnblock(this.catalogs, this.behaviours, contract))
    );
  }

  tagById(id: string): Tag | null {
    return this.byId.get(id) ?? null;
  }

  slotFields(contract: ContractId, slot: string): readonly SlotField[] {
    const key = `${contract} ${slot}`;
    let fields = this.slotIndex.get(key);
    if (fields === undefined) {
      fields = this.typesSupporting(contract).flatMap((id) => {
        const name = this.byId.get(id)?.contracts?.[contract]?.slots[slot];
        return name === undefined ? [] : [{ tag: id, name }];
      });
      this.slotIndex.set(key, fields);
    }
    return fields;
  }

  wordsAt(contract: ContractId, phase: StatusPhase): readonly TagWords[] {
    const key = `${contract} ${phase}`;
    let words = this.wordIndex.get(key);
    if (words === undefined) {
      words = this.typesSupporting(contract).flatMap((id) => {
        const tag = this.byId.get(id);
        const name = tag === undefined ? undefined : lifecycleOf(tag)?.field;
        const at = this.wordsOf(id, phase);
        return name === undefined || at.size === 0 ? [] : [{ tag: id, name, words: [...at] }];
      });
      this.wordIndex.set(key, words);
    }
    return words;
  }

  hiddenStatuses(): readonly string[] {
    return [...new Set(this.tags.flatMap((tag) => terminalStatuses(tag)))];
  }

  nameOf(word: string): string {
    return this.identities.typeOf(word)?.name ?? word;
  }

  fieldNameOf(typeId: string, field: string): string {
    return this.identities.fieldNameOf(typeId, field);
  }

  tagsWithField(name: string): string[] {
    return this.tags.flatMap((tag) => (tag.fields[name] === undefined ? [] : [tag.id]));
  }

  revision(): VocabularyRevision {
    if (this.revised === null) {
      const declarations = [...this.byId.values()]
        .sort((one, other) => (one.id < other.id ? -1 : one.id > other.id ? 1 : 0))
        .map(({ prompt: _prompt, sections: _sections, name: _name, contracts, ...operative }) =>
          contracts === undefined || VOCABULARY_FORMAT < DECLARED_CONTRACTS_FROM ? operative : { ...operative, contracts },
        );
      this.revised = {
        format: VOCABULARY_FORMAT,
        revision: sha256().update(canonicalJson(declarations)).digest('hex'),
      };
    }
    return this.revised;
  }

  lawProjectionOf(typeId: string): LawProjection | null {
    return this.laws.get(typeId) ?? null;
  }

  lawBearingTypes(): readonly string[] {
    return this.lawTypes;
  }

  provenanceOf(typeId: string): Provenance | null {
    return this.compiled.get(typeId)?.provenance ?? null;
  }

  descendantsOf(typeId: string | readonly string[]): readonly string[] {
    const roots = typeof typeId === 'string' ? [typeId] : typeId;
    const visited = new Set(roots);
    const queue = [...visited];
    const found: string[] = [];
    for (let at = 0; at < queue.length; at += 1) {
      for (const child of this.children.get(queue[at]!) ?? []) {
        if (visited.has(child)) continue;
        visited.add(child);
        queue.push(child);
        found.push(child);
      }
    }
    return found;
  }

  redeclare(
    declaration: Declaration,
    replacing: DeclaringNode | null,
  ): Effect.Effect<readonly Redeclared[], GateRefusal<'tag-incoherent'>> {
    const outcome = recompile(
      { types: this.compiled, resolve: this.resolve, behaviours: this.behaviours, descendantsOf: (id) => this.descendantsOf(id) },
      declaration,
      replacing,
    );
    return Result.isSuccess(outcome) ? Effect.succeed(outcome.success) : Effect.fail(outcome.failure);
  }
}
