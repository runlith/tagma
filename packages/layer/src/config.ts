import { isGenerator } from './Graph.js';
import {
  Service,
  type AnyKey,
  type AnyKeyClass,
  type InstanceOf,
  type KeyStatic,
  type Provided,
  type ReachableFrom,
  type SelfMade,
  type Tier,
} from './key.js';
import { Layer } from './Layer.js';

export class ConfigError extends Error {
  constructor(
    override readonly name: string,
    readonly raw: string,
    expected: string,
  ) {
    super(`Config "${name}" is ${JSON.stringify(raw)}, which is not ${expected}`);
  }
}

export interface ConfigField<T> {
  readonly name: string;
  readonly fallback: T;
  read(raw: string): T;
}

export type ConfigStrings = Record<string, string | undefined>;

type ValuesOf<F> = { readonly [Field in keyof F]: F[Field] extends ConfigField<infer T> ? T : never };

type OptionalKeys<T> = { [Field in keyof T]-?: undefined extends T[Field] ? Field : never }[keyof T];

export type ConfigDefaults<T> = Required<Pick<T, OptionalKeys<T>>>;

export type ConfigSnapshot<T> = { readonly [Field in keyof T]-?: Exclude<T[Field], undefined> };

export type ConfigInput<T> = { readonly [Field in keyof T]?: T[Field] | undefined };

export type ConfigClass<Id extends string, Payload, S = ConfigSnapshot<Payload>, Tr extends Tier = Tier> = (abstract new (
  ...args: never[]
) => object) &
  KeyStatic<Id, S, Tr> & { of(input: Payload): S };

export type ConfigStringsClass<Id extends string, Payload, S = ConfigSnapshot<Payload>, Tr extends Tier = Tier> = ConfigClass<
  Id,
  Payload,
  S,
  Tr
> &
  SelfMade<S> & {
    read(): S;
  };

type PayloadOf<K> = K extends { of(input: infer Payload): unknown } ? Payload : never;

type Values = Record<string, unknown>;

const defaultsOf = new WeakMap<object, Values>();

function snapshot(defaults: Values, inputs: readonly Values[]): Values {
  const values: Values = { ...defaults };
  for (const input of inputs) {
    for (const [field, value] of Object.entries(input)) {
      if (value !== undefined) values[field] = value;
    }
  }
  return Object.freeze(values);
}

function declare(id: string, tier: Tier, defaults: Values, source?: () => Values): AnyKeyClass {
  const owner = Service<Values>()(id, { tier });
  const take = (): Values => snapshot(defaults, [(source as () => Values)()]);
  const declared = source
    ? class extends owner {
        static make(): Values {
          return take();
        }
      }
    : owner;

  Object.defineProperty(declared, 'of', { value: (input: Values) => snapshot(defaults, [input]) });
  if (source) Object.defineProperty(declared, 'read', { value: take });
  defaultsOf.set(declared, defaults);

  return declared as AnyKeyClass;
}

const TRUE = new Set(['true', 'yes', 'on', '1', 'y']);
const FALSE = new Set(['false', 'no', 'off', '0', 'n']);

function boolean(name: string, fallback: boolean): ConfigField<boolean> {
  return {
    name,
    fallback,
    read(raw) {
      const value = raw.trim().toLowerCase();
      if (TRUE.has(value)) return true;
      if (FALSE.has(value)) return false;
      throw new ConfigError(name, raw, 'a boolean');
    },
  };
}

function string(name: string, fallback: string): ConfigField<string> {
  return { name, fallback, read: (raw) => raw.trim() };
}

function int(name: string, fallback: number): ConfigField<number> {
  return {
    name,
    fallback,
    read(raw) {
      const value = Number(raw.trim());
      if (!Number.isInteger(value)) throw new ConfigError(name, raw, 'an integer');
      return value;
    },
  };
}

function literals<const V extends readonly string[]>(name: string, values: V, fallback: V[number]): ConfigField<V[number]> {
  return {
    name,
    fallback,
    read(raw) {
      const value = raw.trim();
      if (!values.includes(value)) throw new ConfigError(name, raw, `one of ${values.join(', ')}`);
      return value;
    },
  };
}

function fallbacks(fields: Record<string, ConfigField<unknown>>): Values {
  return Object.fromEntries(Object.entries(fields).map(([field, spec]) => [field, spec.fallback]));
}

function readStrings(fields: Record<string, ConfigField<unknown>>, source: ConfigStrings): Values {
  const values: Values = {};
  for (const [field, spec] of Object.entries(fields)) {
    const raw = source[spec.name];
    values[field] = raw === undefined || raw.trim() === '' ? spec.fallback : spec.read(raw);
  }
  return values;
}

interface OwnedOptions<T, Tr extends Tier = Tier> {
  readonly tier: Tr;
  readonly defaults: ConfigDefaults<T>;
}

interface StringsOptions<F, Tr extends Tier = Tier> {
  readonly tier: Tr;
  readonly fields: F;
  readonly from: ConfigStrings;
}

function define<T extends object>(): <const Id extends string, const Tr extends Tier>(
  id: Id,
  options: OwnedOptions<T, Tr>,
) => ConfigClass<Id, T, ConfigSnapshot<T>, Tr>;
function define<const Id extends string, F extends Record<string, ConfigField<unknown>>, const Tr extends Tier>(
  id: Id,
  options: StringsOptions<F, Tr>,
): ConfigStringsClass<Id, ConfigInput<ValuesOf<F>>, ConfigSnapshot<ValuesOf<F>>, Tr>;
function define(id?: string, options?: StringsOptions<Record<string, ConfigField<unknown>>>): unknown {
  if (id === undefined) {
    return (ownedId: string, owned: OwnedOptions<object>) => declare(ownedId, owned.tier, owned.defaults as Values);
  }
  const { fields, from, tier } = options as StringsOptions<Record<string, ConfigField<unknown>>>;
  return declare(id, tier, fallbacks(fields), () => readStrings(fields, from));
}

function from<K extends AnyKeyClass, Y extends AnyKey = never>(
  key: K,
  source: () => Generator<Y, PayloadOf<K>, unknown> | PayloadOf<K>,
  brand?: ConfigInput<InstanceOf<K>>,
): Layer<Provided<K>, ReachableFrom<K, Y>> {
  const defaults = defaultsOf.get(key);
  if (!defaults) throw new Error(`Config.from expects a Config.define key, got "${key.id}"`);

  return Layer.provide(key, function* () {
    const produced = source();
    const payload = isGenerator(produced) ? yield* produced : produced;
    return snapshot(defaults, brand ? [brand as Values, payload as Values] : [payload as Values]) as never;
  }) as Layer<Provided<K>, ReachableFrom<K, Y>>;
}

export const Config = { define, from, boolean, string, int, literals } as const;
