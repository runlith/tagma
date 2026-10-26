import { Context } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type {
  Bound,
  BehaviourAction,
  BehaviourEdge,
  BehaviourSlot,
  BehaviourWord,
  ContractBinding,
  ContractId,
} from '../wire/tags/behaviour.js';
import type { Gate, TagFields, TagRoles } from '../wire/tags/declaration.js';

export type Behaviour = {
  readonly id: ContractId;
  readonly slots: Readonly<Record<string, BehaviourSlot>>;
  readonly words: Readonly<Record<string, BehaviourWord>>;
  readonly actions: readonly BehaviourAction[];
  readonly requires: readonly ContractId[];
  readonly edges?: readonly BehaviourEdge[];
  readonly check?: (bound: Bound, over: BoundType) => GateRefusal<'tag-incoherent'> | null;
  readonly fromRoles?: (roles: TagRoles, fields: TagFields) => ContractBinding | null;
};

export type BoundType = {
  readonly fields: TagFields;
  readonly gates: readonly Gate[];
  binding(contract: ContractId): ContractBinding | null;
};

export type Registered = { readonly behaviour: Behaviour; readonly owner: string };

export interface BehaviourRegistry {
  readonly contracts: readonly ContractId[];
  readonly edges: readonly BehaviourEdge[];
  edge(kind: string): BehaviourEdge | null;
  get(id: string): Registered | null;
}

export const BEHAVIOURS = new ContributionPoint<Behaviour>('graph/behaviours');

export class Behaviours extends Context.Service<Behaviours, BehaviourRegistry>()('tagma/graph/Behaviours') {}
