import { mount, unmount, type Component } from 'svelte';

import { Failure } from '../Failure.js';
import type { DataBuild } from '../Graph.js';
import type { AnyKeyClass, KeyClass, Resolver } from '../key.js';
import { Layer, type AnyLayer, type LayerItem, type LayerLike } from '../Layer.js';
import { MountedApp, App, type Closed, type Sources } from '../App.js';
import type { AnyRung, RungInput, RungName } from '../Rung.js';
import { App as SvelteApp, worldHooks } from './App.svelte.js';
import AppHost from './AppHost.svelte';

export type At<L extends readonly AnyRung[]> = {
  readonly [R in L[number] as RungName<R>]?: RungInput<R> | ((app: Resolver) => RungInput<R> | undefined);
};

export interface TestOptions<L extends readonly AnyRung[] = readonly []> {
  readonly ladder?: L;
  readonly at?: At<L>;
  readonly data?: DataBuild;
  readonly onFailure?: (error: unknown) => void;
}

export interface TestApp<L extends readonly AnyRung[] = readonly []> {
  readonly app: MountedApp;
  get<Self>(key: KeyClass<string, Self>): Self;
  place<Name extends RungName<L[number]>>(rung: Name, input: RungInput<Extract<L[number], { name: Name }>> | undefined): void;
  unmount(): Promise<void>;
}

type HostProps = { create: () => MountedApp; onReady: (app: MountedApp) => void };

function without(layer: AnyLayer, spoken: ReadonlySet<AnyKeyClass>): AnyLayer {
  const stood: LayerItem[] = [];
  for (const key of spoken) {
    const carried = new Set(layer.items.filter((item) => 'key' in item && item.key === key));
    if (carried.size === 1) stood.push(...carried);
  }
  return new Layer(layer.items.filter((item) => !stood.includes(item)));
}

export function test<M extends LayerLike, B extends LayerLike, const L extends readonly AnyRung[] = readonly []>(
  manifest: M,
  boot: Closed<M, B | Layer<Sources<L>, never>, L>,
  options: TestOptions<L> = {},
): TestApp<L> {
  const target = document.createElement('div');
  document.body.appendChild(target);

  const ladder = (options.ladder ?? []) as L;
  let at = $state<Record<string, unknown>>({ ...(options.at ?? {}) });
  let mountedApp: MountedApp | undefined;

  const appResolver: Resolver = {
    resolve: <Self>(key: KeyClass<string, Self>): Self => {
      if (key.tier !== 'app') throw new Error(`a rung source resolves app-tier keys only; "${key.id}" is ${key.tier}-tier`);
      if (!mountedApp) throw new Error('The rung source reads the app before it exists');
      return mountedApp.graph.resolve(key, mountedApp.app);
    },
  };

  const sources = ladder.map((rung) =>
    rung.of(() => {
      const current = at[rung.name];
      return (typeof current === 'function' ? (current as (app: Resolver) => object | undefined)(appResolver) : current) as
        | object
        | undefined;
    }),
  );

  const spoken = new Set<AnyKeyClass>(ladder.map((rung) => rung.Source as AnyKeyClass));
  if (options.onFailure) spoken.add(Failure as unknown as AnyKeyClass);

  const definition = App.define(
    Layer.mergeAll(
      without(Layer.mergeAll(manifest, boot as LayerLike), spoken),
      ...sources,
      options.onFailure ? Failure.of(options.onFailure) : Layer.mergeAll(),
    ),
    { data: options.data, ladder },
  );

  const held = new MountedApp(definition, Layer.mergeAll(), worldHooks);
  mountedApp = held;

  let app: ReturnType<typeof mount>;
  try {
    app = mount(AppHost as Component<HostProps>, {
      target,
      props: {
        create: () => SvelteApp.attach(held),
        onReady: () => undefined,
      },
    });
  } catch (error) {
    void held.close();
    target.remove();
    throw error;
  }

  return {
    app: held,
    get: (key) => held.resolve(key),
    place: (rung, input) => {
      at = { ...at, [rung]: input };
    },
    unmount: async () => {
      await unmount(app);
      await held.close();
      target.remove();
    },
  };
}
