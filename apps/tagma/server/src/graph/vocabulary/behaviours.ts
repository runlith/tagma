import { Data, Result } from 'effect';
import { canonicalJson } from '@runlith/utils/object';
import type { Contributed } from '../../platform/contract/wire/contribution.js';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import type { FieldType, Gate, TagFields, TagRoles } from '../contract/wire/tags/declaration.js';
import type { BehaviourEdge, Bound, ContractBinding, ContractBindings, ContractId, SlotKind } from '../contract/wire/tags/behaviour.js';
import type { Behaviour, BehaviourRegistry, Registered } from '../contract/service/behaviours.js';
import { CORE_EDGES } from '../contract/wire/edges.js';

const own = <V>(record: Readonly<Record<string, V>>, key: string): V | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

export class BehaviourInvalid extends Data.TaggedError('BehaviourInvalid')<{
  readonly contract: string;
  readonly owners: readonly string[];
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.contract} (${this.owners.join(', ')}): ${this.reason}`;
  }
}

export function registerBehaviours(contributed: readonly Contributed<Behaviour>[], operations: ReadonlySet<string>): BehaviourRegistry {
  const byId = new Map<string, Registered>();
  for (const { owner, entry } of contributed) {
    const standing = byId.get(entry.id);
    if (standing !== undefined)
      throw new BehaviourInvalid({ contract: entry.id, owners: [standing.owner, owner], reason: 'two modules register one contract' });
    byId.set(entry.id, { behaviour: entry, owner });
  }
  for (const { behaviour, owner } of byId.values()) {
    for (const required of behaviour.requires) {
      if (!byId.has(required))
        throw new BehaviourInvalid({
          contract: behaviour.id,
          owners: [owner],
          reason: `it requires ${required}, which no module registers`,
        });
    }
    for (const [meaning, word] of Object.entries(behaviour.words)) {
      if (word.contract !== undefined && !behaviour.requires.includes(word.contract)) {
        throw new BehaviourInvalid({
          contract: behaviour.id,
          owners: [owner],
          reason: `its word ${meaning} reads a slot of ${word.contract}, which it does not require`,
        });
      }
      const over = word.contract === undefined ? behaviour : byId.get(word.contract)?.behaviour;
      if (over === undefined || own(over.slots, word.slot)?.kind !== 'enum') {
        throw new BehaviourInvalid({
          contract: behaviour.id,
          owners: [owner],
          reason: `its word ${meaning} reads slot "${word.slot}", which is not an enum slot of ${over?.id ?? word.contract}`,
        });
      }
    }
    const invalid = (reason: string) => new BehaviourInvalid({ contract: behaviour.id, owners: [owner], reason });
    for (const { op, moves, writes } of behaviour.actions) {
      if (!operations.has(op)) throw invalid(`its action names operation ${op}, which no module declares`);
      for (const move of moves ?? []) {
        const over = move.contract === undefined ? behaviour : byId.get(move.contract)?.behaviour;
        for (const word of [move.to, ...(move.needs ?? [])]) {
          if (over === undefined || own(over.words, word) === undefined)
            throw invalid(`${op} reads word ${word}, which ${move.contract ?? behaviour.id} does not read`);
        }
      }
      for (const slot of writes ?? []) {
        if (own(behaviour.slots, slot) === undefined) throw invalid(`${op} writes slot "${slot}", which ${behaviour.id} does not have`);
      }
    }
  }
  const byEdge = new Map<string, BehaviourEdge>();
  for (const { behaviour, owner } of byId.values()) {
    for (const edge of behaviour.edges ?? []) {
      const standing = byEdge.get(edge.kind);
      if (standing !== undefined)
        throw new BehaviourInvalid({
          contract: behaviour.id,
          owners: [byId.get(standing.from)!.owner, owner],
          reason: `two contracts declare the meaning of edge "${edge.kind}"`,
        });
      if (edge.from !== behaviour.id || !byId.has(edge.to))
        throw new BehaviourInvalid({
          contract: behaviour.id,
          owners: [owner],
          reason: `edge "${edge.kind}" must start at its declaring contract and target a registered contract`,
        });
      if (CORE_EDGES.includes(edge.kind))
        throw new BehaviourInvalid({
          contract: behaviour.id,
          owners: [owner],
          reason: `edge "${edge.kind}" belongs to the core: every node carries it, so no contract narrows its ends`,
        });
      byEdge.set(edge.kind, edge);
    }
  }
  const contracts = [...byId.keys()] as ContractId[];
  return { contracts, edges: [...byEdge.values()], edge: (kind) => byEdge.get(kind) ?? null, get: (id) => byId.get(id) ?? null };
}

export function translateRoles(roles: TagRoles, fields: TagFields, registry: BehaviourRegistry): ContractBindings {
  const translated: Record<ContractId, ContractBinding> = {};
  for (const contract of registry.contracts) {
    const binding = registry.get(contract)?.behaviour.fromRoles?.(roles, fields) ?? null;
    if (binding !== null) translated[contract] = binding;
  }
  return translated;
}

export type BindingPart = { readonly from: string; readonly contracts: ContractBindings };

type Bind<A> = Result.Result<A, GateRefusal<'tag-incoherent'>>;

const refuse = (reason: string, unblock: Unblock): Bind<never> => Result.fail(new GateRefusal('tag-incoherent', reason, unblock));

function fits(kind: SlotKind | undefined, type: FieldType): boolean {
  if (kind === undefined) return true;
  if (typeof kind === 'object') return typeof type === 'object' && type.type === 'schema' && type.name === kind.schema;
  if (kind === 'enum') return typeof type === 'object' && type.type === 'enum';
  return type === kind;
}

function spell(kind: SlotKind | undefined): string {
  if (kind === undefined) return 'any type';
  if (typeof kind === 'object') return `{type: "schema", name: "${kind.schema}"}`;
  return kind === 'enum' ? '{type: "enum", values: [...]}' : `"${kind}"`;
}

function shaped(contract: ContractId, binding: ContractBinding, from: string, behaviour: Behaviour, fields: TagFields): Bind<void> {
  const at = `#${from}.contracts["${contract}"]`;
  for (const slot of Object.keys(binding.slots)) {
    if (own(behaviour.slots, slot) === undefined) {
      return refuse(`${at} binds slot "${slot}", which ${contract} does not have`, [
        `bind the slots of ${contract}: ${Object.keys(behaviour.slots).join(', ') || 'it has none'}`,
      ]);
    }
  }
  for (const [slot, declared] of Object.entries(behaviour.slots)) {
    const field = own(binding.slots, slot);
    if (field === undefined) {
      if (declared.optional === true) continue;
      return refuse(`${at} leaves slot "${slot}" unbound`, [`bind "${slot}" to a field #${from} declares as ${spell(declared.kind)}`]);
    }
    const type = own(fields, field);
    if (type === undefined) {
      return refuse(`${at} binds slot "${slot}" to "${field}", which #${from} does not declare`, [
        `declare #${from}.fields.${field} as ${spell(declared.kind)}`,
      ]);
    }
    if (!fits(declared.kind, type)) {
      return refuse(`${at} binds slot "${slot}" to "${field}", which is not declared as ${spell(declared.kind)}`, [
        `declare #${from}.fields.${field} as ${spell(declared.kind)}, or bind "${slot}" to a field that is`,
      ]);
    }
  }
  for (const meaning of Object.keys(binding.words)) {
    if (own(behaviour.words, meaning) === undefined) {
      return refuse(`${at} names word "${meaning}", which ${contract} does not read`, [
        `name the words of ${contract}: ${Object.keys(behaviour.words).join(', ') || 'it reads none'}`,
      ]);
    }
  }
  for (const [meaning, declared] of Object.entries(behaviour.words)) {
    const word = own(binding.words, meaning);
    if (declared.contract !== undefined) {
      if (word === undefined && declared.optional !== true) {
        return refuse(`${at} names no word for "${meaning}"`, [
          `name the word of ${declared.contract}.${declared.slot} that means ${meaning}`,
        ]);
      }
      continue;
    }
    const field = own(binding.slots, declared.slot);
    if (word === undefined) {
      if (declared.optional === true || field === undefined) continue;
      return refuse(`${at} names no word for "${meaning}"`, [`name the word of #${from}.fields.${field} that means ${meaning}`]);
    }
    if (field === undefined) {
      return refuse(`${at} names word "${meaning}" over slot "${declared.slot}", which it leaves unbound`, [
        `bind "${declared.slot}", or drop the word "${meaning}"`,
      ]);
    }
    const type = own(fields, field);
    const values: readonly string[] = typeof type === 'object' && type.type === 'enum' ? type.values : [];
    if (!values.includes(word)) {
      return refuse(`${at} names "${word}" for ${meaning}, which #${from}.fields.${field} does not hold`, [
        `name one of ${values.join(', ')}`,
      ]);
    }
  }
  return Result.succeed(undefined);
}

export function bindContracts(
  parts: readonly BindingPart[],
  fields: TagFields,
  gates: readonly Gate[],
  registry: BehaviourRegistry,
): Bind<readonly Bound[]> {
  const bound = new Map<ContractId, Bound>();
  for (const { from, contracts } of parts) {
    for (const [contract, binding] of Object.entries(contracts) as [ContractId, ContractBinding][]) {
      const registered = registry.get(contract);
      if (registered === null) {
        return refuse(`#${from} binds ${contract}, which no module registers`, [
          `bind one of the registered contracts: ${registry.contracts.join(', ') || 'none is registered'}`,
        ]);
      }
      const shape = shaped(contract, binding, from, registered.behaviour, fields);
      if (Result.isFailure(shape)) return Result.fail(shape.failure);
      const standing = bound.get(contract);
      if (standing === undefined) {
        bound.set(contract, { contract, binding, from });
      } else if (canonicalJson(standing.binding) !== canonicalJson(binding)) {
        return refuse(
          `#${from} binds ${contract} another way than #${standing.from} does: a contract shared by two parts is one binding only when its slots and words are the same`,
          [
            `bind ${contract} on #${from} exactly as #${standing.from} does`,
            `drop ${contract} from #${from} and keep the binding of #${standing.from}`,
          ],
        );
      }
    }
  }
  const fieldOwners = new Map<string, Bound>();
  const stateOwners = new Map<string, Bound>();
  for (const one of bound.values()) {
    const behaviour = registry.get(one.contract)!.behaviour;
    for (const [slot, field] of Object.entries(one.binding.slots)) {
      const other = fieldOwners.get(field);
      if (other !== undefined && other.contract !== one.contract) {
        return refuse(
          `${other.contract} (#${other.from}) and ${one.contract} (#${one.from}) both bind "${field}": two contracts never share a field`,
          [`bind ${one.contract}.${slot} to another field`, `drop one of ${other.contract} and ${one.contract}`],
        );
      }
      fieldOwners.set(field, one);
      const state = own(behaviour.slots, slot)?.state;
      if (state === undefined) continue;
      const holder = stateOwners.get(state);
      if (holder !== undefined && holder.contract !== one.contract) {
        return refuse(
          `${holder.contract} (#${holder.from}) and ${one.contract} (#${one.from}) both hold the node's ${state}: one single-valued state has one binding owner`,
          [`drop one of ${holder.contract} and ${one.contract}`],
        );
      }
      stateOwners.set(state, one);
    }
  }
  for (const one of bound.values()) {
    const behaviour = registry.get(one.contract)!.behaviour;
    for (const required of behaviour.requires) {
      if (!bound.has(required)) {
        return refuse(`${one.contract} (#${one.from}) requires ${required}, which nothing here binds`, [
          `bind ${required} as well`,
          `drop ${one.contract}`,
        ]);
      }
    }
    for (const [meaning, declared] of Object.entries(behaviour.words)) {
      const word = own(one.binding.words, meaning);
      if (declared.contract === undefined || word === undefined) continue;
      const field = own(bound.get(declared.contract)!.binding.slots, declared.slot);
      const type = field === undefined ? undefined : own(fields, field);
      const values: readonly string[] = typeof type === 'object' && type.type === 'enum' ? type.values : [];
      if (!values.includes(word)) {
        return refuse(
          `${one.contract} (#${one.from}) names "${word}" for ${meaning}, which ${declared.contract}.${declared.slot} does not hold`,
          [`name one of ${values.join(', ') || 'its words'}`],
        );
      }
    }
    const incoherent = behaviour.check?.(one, { fields, gates, binding: (id) => bound.get(id as ContractId)?.binding ?? null }) ?? null;
    if (incoherent !== null) return Result.fail(incoherent);
  }
  return Result.succeed([...bound.values()]);
}
