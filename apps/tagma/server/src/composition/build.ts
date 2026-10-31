import type { Context, Layer, ManagedRuntime } from 'effect';
import type { Manifest } from '../platform/contract/service/manifest.js';
import type { Channel } from '../installation/contract/wire/channel.js';
import type { Composition } from '../installation/cut/release.js';
import type { Bindings } from './next.js';
import type { CoreBindings, VerbBindings, VerbModule } from './cli/binding.js';
import type { LiveDoorOf, SocketDoor } from './socketBinding.js';
import type { ControlServices, SettingControlNeeds } from './settings.js';
import type { ServerRuntime } from './runtime.js';
import type { CORE_MODULES } from './core.js';

type Installed = ServerRuntime['runtime'] extends ManagedRuntime.ManagedRuntime<infer R, never> ? R : never;
type Served = ServerRuntime['owners'] extends Context.Context<infer R> ? R : never;

type Tier = 'installation' | 'serving';

type LifetimeOf<M, T extends Tier> = M extends { readonly lifetimes: { readonly [K in T]: infer L extends Layer.Any } } ? L : never;

type Needs<M, T extends Tier> = Layer.Services<LifetimeOf<M, T>>;
type Gives<M, T extends Tier> = Layer.Success<LifetimeOf<M, T>>;

type Extension<Modules extends readonly Manifest[]> = Exclude<Modules[number], (typeof CORE_MODULES)[number]>;

type Unserved<Modules extends readonly Manifest[], E = Extension<Modules>> =
  | Exclude<LiveDoorOf<Modules[number]>, SocketDoor | Gives<E, 'installation'> | Gives<E, 'serving'>>
  | Exclude<ControlServices<Modules[number]>, SettingControlNeeds>
  | Exclude<Needs<E, 'installation'>, Installed>
  | Exclude<Needs<E, 'serving'>, Served | Installed | Gives<E, 'installation'>>
  | Untiered<E>;

type Untiered<E> = E extends { readonly lifetimes: infer L } ? Extract<keyof L, 'workspace' | 'run' | 'call'> : never;

declare const checked: unique symbol;

export type CheckedParts = ServerParts & { readonly [checked]: true };

export type ServerParts<Modules extends readonly Manifest[] = readonly Manifest[]> = {
  readonly modules: Modules;
  readonly bindings: Bindings;
  readonly rested: () => Worker;
};

export const serverParts = <const Modules extends readonly Manifest[]>(
  parts: ServerParts<Modules> & ([Unserved<Modules>] extends [never] ? unknown : { readonly unserved: Unserved<Modules> }),
): CheckedParts => parts as unknown as CheckedParts;

export type Build = {
  readonly channel: Channel;
  readonly verbs: readonly VerbModule[];
  readonly verbBindings: (core: CoreBindings) => VerbBindings;
  readonly parts: () => Promise<CheckedParts>;
  readonly cut: Composition;
};
