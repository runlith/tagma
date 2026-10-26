import type { Reader } from './condition.js';
import {
  Service,
  type AnyKeyClass,
  type InstanceOf,
  type Ladder,
  type Provided,
  type ReachableFrom,
  type ServiceClass,
  type Tier,
  type UnderOf,
} from './key.js';
import { Layer, type Out, type Want } from './Layer.js';

type ValuesOf<Ks> = { -readonly [I in keyof Ks]: InstanceOf<Ks[I]> };

type UnderField<Name> = [UnderOf<Name>] extends [never]
  ? { readonly under?: AnyRung }
  : [UnderOf<Name>] extends ['app']
    ? { readonly under?: undefined }
    : { readonly under: RungDef<UnderOf<Name> & string, object, string, Out> };

type AlwaysField<Name> = Name extends keyof Ladder
  ? Ladder[Name] extends { readonly always: true }
    ? { readonly always: true }
    : { readonly always?: false }
  : { readonly always?: boolean };

export type RungDefinition<Input extends object, Kind extends string, Name extends string = string, Own extends Out = never> = {
  readonly keyOf: (input: Input) => string;
  readonly kindOf?: (input: Input) => Kind;
  readonly kinds?: readonly Kind[];
  readonly own?: () => Layer<Own, Want>;
} & UnderField<Name> &
  AlwaysField<Name>;

type Answer<Name, Input> = Name extends keyof Ladder
  ? Ladder[Name] extends { readonly always: true }
    ? Input
    : Input | undefined
  : Input | undefined;

type SourceKey<Name extends string, Input extends object> = ServiceClass<`${Name}.Source`, () => Answer<Name, Input>, 'app'>;

export interface RungDef<Name extends string, Input extends object, Kind extends string, Own extends Out = never> {
  readonly name: Name;
  readonly under: AnyRung | undefined;
  readonly always: boolean;
  own(): Layer<Own, Want>;
  readonly Source: SourceKey<Name, Input>;
  readonly Current: ServiceClass<Name, Input, Name & Tier>;
  readonly kinds: readonly Kind[];
  readonly dependency: `layer:${Name}`;
  keyOf(input: Input): string;
  kindOf(input: Input): Kind | undefined;
  from<K extends AnyKeyClass>(
    key: K,
    read: (value: InstanceOf<K>) => Answer<Name, Input>,
  ): Layer<Provided<SourceKey<Name, Input>>, ReachableFrom<SourceKey<Name, Input>, Provided<K>>>;
  from<const Ks extends readonly AnyKeyClass[]>(
    keys: Ks,
    read: (...values: ValuesOf<Ks>) => Answer<Name, Input>,
  ): Layer<Provided<SourceKey<Name, Input>>, ReachableFrom<SourceKey<Name, Input>, Provided<Ks[number]>>>;
  of(read: () => Answer<Name, Input>): Layer<Provided<SourceKey<Name, Input>>, never>;
  present<const K extends Kind = never>(kind?: K): Reader<[K] extends [never] ? `${Name}.present` : `${Name}.${K}.present`>;
}

export type AnyRung = RungDef<string, object, string, Out>;

export type RungInput<R> = R extends RungDef<string, infer Input, string, Out> ? Input : never;

export type RungKind<R> = R extends RungDef<string, object, infer Kind, Out> ? Kind : never;

export type RungName<R> = R extends RungDef<infer Name, object, string, Out> ? Name : never;

export type RungOwn<R> = R extends RungDef<string, object, string, infer Own> ? Own : never;

export function placeOf(parentPlace: string | undefined, rung: string, key: string): string {
  const segment = `${rung}:${key.replace(/%/g, '%25').replace(/\//g, '%2F')}`;
  return parentPlace === undefined ? segment : `${parentPlace}/${segment}`;
}

function define<Input extends object, Kind extends string = never, Own extends Out = never>() {
  return <const Name extends string>(name: Name, definition: RungDefinition<Input, Kind, Name, Own>): RungDef<Name, Input, Kind, Own> => {
    if (definition.kindOf !== undefined && (definition.kinds === undefined || definition.kinds.length === 0)) {
      throw new Error(`Rung "${name}" answers a kind and lists none: name its kinds`);
    }
    if (/[/:]/.test(name)) throw new Error(`Rung "${name}" carries "/" or ":": a rung name is one segment of a scope's place`);
    const Source = Service<() => Answer<Name, Input>>()(`${name}.Source` as `${Name}.Source`, { tier: 'app' });
    const Current = Service<Input>()(name, { tier: name as Name & Tier });
    const kinds = definition.kinds ?? [];

    const from = (first: AnyKeyClass | readonly AnyKeyClass[], read: (...values: unknown[]) => Answer<Name, Input>) => {
      const keys = Array.isArray(first) ? (first as readonly AnyKeyClass[]) : [first as AnyKeyClass];
      return Layer.provide(Source, function* () {
        const values: unknown[] = [];
        for (const key of keys) values.push(yield key.key as never);
        return () => read(...values);
      });
    };

    return {
      name,
      under: definition.under,
      always: definition.always === true,
      own: (): Layer<Own, Want> => definition.own?.() ?? Layer.mergeAll(),
      Source,
      Current,
      kinds,
      dependency: `layer:${name}`,
      keyOf: definition.keyOf,
      kindOf: (input) => definition.kindOf?.(input),
      from: from as unknown as RungDef<Name, Input, Kind, Own>['from'],
      of: (read) => Layer.of(Source, read),
      present: <const K extends Kind = never>(kind?: K) => ({ tier: (kind ?? name) as Tier, read: () => true }),
    };
  };
}

export const Rung = { define } as const;
