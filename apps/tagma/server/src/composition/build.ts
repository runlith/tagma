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

type LifetimeNeeds<M, Tier extends 'installation' | 'serving'> = M extends {
  readonly lifetimes: { readonly [K in Tier]: Layer.Layer<never, unknown, infer R> };
}
  ? R
  : never;

type Extension<Modules extends readonly Manifest[]> = Exclude<Modules[number], (typeof CORE_MODULES)[number]>;

type Unserved<Modules extends readonly Manifest[]> =
  | Exclude<LiveDoorOf<Modules[number]>, SocketDoor>
  | Exclude<ControlServices<Modules[number]>, SettingControlNeeds>
  | Exclude<LifetimeNeeds<Extension<Modules>, 'installation'>, Installed>
  | Exclude<LifetimeNeeds<Extension<Modules>, 'serving'>, Served | Installed>;

export type ServerParts<Modules extends readonly Manifest[] = readonly Manifest[]> = {
  readonly modules: Modules;
  readonly bindings: Bindings;
  readonly rested: () => Worker;
};

export const serverParts = <const Modules extends readonly Manifest[]>(
  parts: ServerParts<Modules> & ([Unserved<Modules>] extends [never] ? unknown : { readonly unserved: Unserved<Modules> }),
): ServerParts<Modules> => parts;

export type Build = {
  readonly channel: Channel;
  readonly verbs: readonly VerbModule[];
  readonly verbBindings: (core: CoreBindings) => VerbBindings;
  readonly parts: () => Promise<ServerParts>;
  readonly cut: Composition;
};
