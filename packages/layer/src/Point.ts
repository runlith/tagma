import type { Cell } from '@runlith/roster/cell';
import { Roster } from '@runlith/roster/Roster';

import { Service, type Key, type Optional, type ServiceClass, type Tier } from './key.js';
import { Layer } from './Layer.js';
import { Scope, type ScopeKey } from './Scope.js';

type Drawing<Item> = (item: Item) => Item | null;

interface PointDefinition<Item, Tr extends Tier = Tier> {
  readonly tier: Tr;
  readonly key: (item: Item) => string;
  readonly order?: (item: Item) => number;
  readonly claims?: (item: Item) => readonly string[];
  readonly admits?: (item: Item) => string | null;
  readonly joins?: 'start';
  readonly draws?: () => Generator<Optional, Drawing<Item>, unknown>;
}

type Contribution<Id extends string, From extends string, Item, Tr extends Tier> = Layer<
  Key<`${Id}:${From}`, readonly Item[], Tr>,
  Key<Id, Point<Item>, Tr>
>;

type PointKeyClass<Id extends string, Item, Tr extends Tier> = ServiceClass<Id, Point<Item>, Tr> & {
  readonly definition: PointDefinition<Item, Tr>;
  make(): Generator<ScopeKey | Optional, Point<Item>, unknown>;
  contribute<const From extends string>(from: From, ...items: readonly Item[]): Contribution<Id, From, Item, Tr>;
};

export class Point<Item> {
  constructor(
    readonly id: string,
    readonly key: (item: Item) => string,
    private readonly roster: Roster<Item>,
    private readonly drawing?: Drawing<Item>,
  ) {}

  get items(): readonly Item[] {
    return this.roster.items;
  }

  drawn(item: Item): Item | null {
    return this.drawing === undefined ? item : this.drawing(item);
  }

  find(key: string): Item | undefined {
    return this.roster.find(key);
  }

  register(from: string, ...items: readonly Item[]): () => void {
    return this.roster.add(from, ...items);
  }

  contributorOf(item: Item): string | undefined {
    return this.roster.holderOf(this.key(item));
  }

  derive<Index>(build: (items: readonly Item[]) => Index): () => Index {
    let standing: { readonly items: readonly Item[]; readonly index: Index } | undefined;
    return () => {
      const items = this.items;
      if (standing?.items !== items) standing = { items, index: build(items) };
      return standing.index;
    };
  }

  static over<Item>(
    id: string,
    definition: PointDefinition<Item>,
    cell: Cell<readonly Item[]>,
    starting?: () => boolean,
    drawing?: Drawing<Item>,
  ): Point<Item> {
    const subject = (key: string): string => `Point "${id}" item "${key}"`;
    const admits =
      starting === undefined
        ? definition.admits
        : (item: Item): string | null =>
            starting() ? (definition.admits?.(item) ?? null) : 'this point takes members only while its scope starts';
    return new Point<Item>(id, definition.key, new Roster(subject, definition.key, cell, { ...definition, admits }), drawing);
  }

  static define<Item>() {
    return <const Id extends string, const Tr extends Tier>(id: Id, definition: PointDefinition<Item, Tr>): PointKeyClass<Id, Item, Tr> => {
      class PointKey extends Service<Point<Item>>()(id, { tier: definition.tier }) {
        static readonly definition = definition;

        static *make() {
          const scope = yield* Scope;
          const drawing = definition.draws === undefined ? undefined : yield* definition.draws();
          return Point.over<Item>(
            id,
            definition,
            cellOf<readonly Item[]>(scope),
            definition.joins === 'start' ? startingOf(scope) : undefined,
            drawing,
          );
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

function graphOf(scope: Scope) {
  const graph = scope.graph;
  if (!graph) throw new Error('A point needs a scope the graph opened');
  return graph;
}

function cellOf<T>(scope: Scope): Cell<T> {
  return graphOf(scope).cell<T>();
}

function startingOf(scope: Scope): () => boolean {
  const graph = graphOf(scope);
  const home = scope.home;
  return () => graph.starting(home);
}
