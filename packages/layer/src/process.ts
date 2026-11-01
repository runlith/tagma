import type { BuildDoor } from './door.js';
import type { Ask, DeepestOpen, Tier } from './key.js';
import type { Scope } from './Scope.js';

interface ProcessDefinition<Tr extends Tier = Tier> {
  readonly tier?: Tr;
}

export interface ProcessStatic<Id extends string, Self, Args, Tr extends Tier = Tier> {
  readonly id: Id;
  readonly tier: Tr | undefined;
  make(args: Args): Generator<Ask, Self, unknown> | Self;
  start<K>(this: K & BuildDoor<K>, scope: Scope, args: Args): Self;
}

export type ProcessClass<Id extends string = string, Self = unknown, Args = void, Tr extends Tier = Tier> = (abstract new (
  ...args: never[]
) => object) &
  ProcessStatic<Id, Self, Args, Tr>;

export function Process<Self, Args = void>(): <const Id extends string, const Tr extends Tier = DeepestOpen>(
  id: Id,
  definition?: ProcessDefinition<Tr>,
) => ProcessClass<Id, Self, Args, Tr> {
  return <const Id extends string, const Tr extends Tier = DeepestOpen>(id: Id, definition: ProcessDefinition<Tr> = {}) => {
    abstract class Base {
      static readonly id: Id = id;
      static readonly tier: Tr | undefined = definition.tier;

      static make(): Generator<Ask, Self, unknown> | Self {
        throw new Error(`Process "${id}" declares no static make()`);
      }

      static start(scope: Scope, args: Args): Self {
        const graph = scope.graph;
        if (!graph) throw new Error(`Process "${id}" needs a scope the graph opened: start it from a service's or a screen's scope`);
        const tier = definition.tier;
        if (tier !== undefined && scope.owner(tier) === undefined)
          throw new Error(`Process "${id}" stands at the ${tier} tier, and scope "${scope.name}" lies under no scope of it`);
        return graph.spawn<Self>(scope.child(id), id, () => (this as unknown as ProcessStatic<Id, Self, Args>).make(args));
      }
    }

    return Base as unknown as ProcessClass<Id, Self, Args, Tr>;
  };
}
