import type { BuildDoor } from './door.js';
import type { Ask } from './key.js';
import type { Scope } from './Scope.js';

export interface ProcessStatic<Id extends string, Self, Args> {
  readonly id: Id;
  make(args: Args): Generator<Ask, Self, unknown> | Self;
  start<K>(this: K & BuildDoor<K>, scope: Scope, args: Args): Self;
}

export type ProcessClass<Id extends string = string, Self = unknown, Args = void> = (abstract new (...args: never[]) => object) &
  ProcessStatic<Id, Self, Args>;

export function Process<Self, Args = void>(): <const Id extends string>(id: Id) => ProcessClass<Id, Self, Args> {
  return <const Id extends string>(id: Id) => {
    abstract class Base {
      static readonly id: Id = id;

      static make(): Generator<Ask, Self, unknown> | Self {
        throw new Error(`Process "${id}" declares no static make()`);
      }

      static start(scope: Scope, args: Args): Self {
        const graph = scope.graph;
        if (!graph) throw new Error(`Process "${id}" needs a scope the graph opened: start it from a service's or a screen's scope`);
        return graph.spawn<Self>(scope.child(id), id, () => (this as ProcessStatic<Id, Self, Args>).make(args));
      }
    }

    return Base as unknown as ProcessClass<Id, Self, Args>;
  };
}
