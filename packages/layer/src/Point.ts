import type { Cell } from '@runlith/roster/cell';
import { Roster } from '@runlith/roster/Roster';

import { Service, type Key, type ServiceClass, type Tier } from './key.js';
import { Layer } from './Layer.js';
import { Scope, type ScopeKey } from './Scope.js';

interface PointDefinition<Item, Tr extends Tier = Tier> {
  readonly tier: Tr;
  readonly key: (item: Item) => string;
  readonly order?: (item: Item) => number;
  readonly claims?: (item: Item) => readonly string[];
}

type Contribution<Id extends string, From extends string, Item, Tr extends Tier> = Layer<
  Key<`${Id}:${From}`, readonly Item[], Tr>,
  Key<Id, Point<Item>, Tr>
>;

type PointKeyClass<Id extends string, Item, Tr extends Tier> = ServiceClass<Id, Point<Item>, Tr> & {
  readonly definition: PointDefinition<Item, Tr>;
  make(): Generator<ScopeKey, Point<Item>, unknown>;
  contribute<const From extends string>(from: From, ...items: readonly Item[]): Contribution<Id, From, Item, Tr>;
};

export class Point<Item> {
  constructor(
    readonly id: string,
    readonly key: (item: Item) => string,
    private readonly roster: Roster<Item>,
  ) {}

  get items(): readonly Item[] {
    return this.roster.items;
  }

  find(key: string): Item | undefined {
    return this.roster.find(key);
  }

  register(from: string, ...items: readonly Item[]): () => void {
    return this.roster.add(from, ...items);
  }

  static over<Item>(id: string, definition: PointDefinition<Item>, cell: Cell<readonly Item[]>): Point<Item> {
    const subject = (key: string): string => `Point "${id}" item "${key}"`;
    return new Point<Item>(id, definition.key, new Roster(subject, definition.key, cell, definition));
  }

  static define<Item>() {
    return <const Id extends string, const Tr extends Tier>(id: Id, definition: PointDefinition<Item, Tr>): PointKeyClass<Id, Item, Tr> => {
      class PointKey extends Service<Point<Item>>()(id, { tier: definition.tier }) {
        static readonly definition = definition;

        static *make() {
          return Point.over<Item>(id, definition, cellOf<readonly Item[]>(yield* Scope));
        }

        static contribute<const From extends string>(from: From, ...items: readonly Item[]): Contribution<Id, From, Item, Tr> {
          const member = Service<readonly Item[]>()(`${id}:${from}`, { tier: definition.tier, eager: true });
          const join = Layer.member(
            () => PointKey,
            (point: Point<Item>, held: readonly Item[]) => point.register(from, ...held),
          );
          return join(Layer.provide(member, (() => items) as never)) as unknown as Contribution<Id, From, Item, Tr>;
        }
      }

      return PointKey as unknown as PointKeyClass<Id, Item, Tr>;
    };
  }
}

function cellOf<T>(scope: Scope): Cell<T> {
  const graph = scope.graph;
  if (!graph) throw new Error('A point needs a scope the graph opened');
  return graph.cell<T>();
}
