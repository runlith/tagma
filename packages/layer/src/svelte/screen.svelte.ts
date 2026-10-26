import { getContext, setContext } from 'svelte';

import type { BuildDoor } from '../door.js';
import type { Ask, DeepestOpen, Tier } from '../key.js';
import { App } from './App.svelte.js';

export interface ScreenDefinition<Tr extends Tier = Tier> {
  readonly tier?: Tr;
}

export interface ScreenStatic<Id extends string, Self, Options, Tr extends Tier = Tier> {
  readonly id: Id;
  readonly tier: Tr | undefined;
  make(options: Options): Generator<Ask, Self, unknown> | Self;
  mount<K>(this: K & BuildDoor<K>, options: Options): Self;
  use(): Self;
}

export type ScreenClass<Id extends string = string, Self = unknown, Options = void, Tr extends Tier = Tier> = (abstract new (
  ...args: never[]
) => object) &
  ScreenStatic<Id, Self, Options, Tr>;

export function Screen<Self, Options = void>(): <const Id extends string, const Tr extends Tier = DeepestOpen>(
  id: Id,
  definition?: ScreenDefinition<Tr>,
) => ScreenClass<Id, Self, Options, Tr> {
  return <const Id extends string, const Tr extends Tier = DeepestOpen>(id: Id, definition: ScreenDefinition<Tr> = {}) => {
    const named = definition.tier;
    abstract class Base {
      static readonly id: Id = id;
      static readonly tier: Tr | undefined = named;

      static make(): Generator<Ask, Self, unknown> | Self {
        throw new Error(`Screen "${id}" declares no static make()`);
      }

      static mount(options: Options): Self {
        const app = App.current();
        const section = App.section(id, named ?? app.alwaysOpen());
        const instance = app.spawn<Self>(section, id, () => (this as unknown as ScreenStatic<Id, Self, Options>).make(options));
        setContext(this, instance);
        return instance;
      }

      static use(): Self {
        const instance = getContext<Self | undefined>(this);
        if (!instance) throw new Error(`Screen "${id}" is not mounted above this component`);
        return instance;
      }
    }

    return Base as unknown as ScreenClass<Id, Self, Options, Tr>;
  };
}
