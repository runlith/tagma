import { BROWSER } from 'esm-env';
import { getContext, onDestroy, setContext, untrack } from 'svelte';
import { withoutReactiveContext } from './detach.js';

import { reactiveCell } from '@runlith/roster/cell.svelte';

import { bindAppResolver, type Deferred, type DeferredKeyClass, type KeyClass, type Tier } from '../key.js';
import { Layer, type LayerLike } from '../Layer.js';
import { currentApp, releaseApp } from '../request/holder.js';
import { Router } from '../Router.js';
import type { AnyRung, RungInput } from '../Rung.js';
import type { Scope } from '../Scope.js';
import { App as Core, MountedApp, type Definition, type WorldHooks } from '../App.js';

const APP = Symbol.for('@runlith/layer');
const HELD = Symbol.for('@runlith/layer/held');

function runWithoutRoot(build: () => void): () => void {
  build();
  return () => undefined;
}

function detachedRoot(build: () => void): () => void {
  return withoutReactiveContext(() => $effect.root(build));
}

function watchCondition(read: () => boolean, initial: boolean, react: (value: boolean) => void): () => void {
  let previous = initial;
  return $effect.root(() => {
    $effect(() => {
      const value = read();
      untrack(() => {
        if (previous === value) return;
        previous = value;
        react(value);
      });
    });
  });
}

export const worldHooks: WorldHooks = BROWSER
  ? { effectRoot: detachedRoot, watch: watchCondition, cell: reactiveCell, start: 'mount' }
  : { effectRoot: runWithoutRoot, start: 'open', data: 'lazy' };

function publish(app: MountedApp, owned: boolean): MountedApp {
  setContext(APP, app);

  untrack(() => {
    app.start();
    void app.adopt();
    if (app.graph.has(Router, app.app)) app.resolve(Router).attach();
  });
  const position = $derived(app.position());
  let adopted = untrack(() => position);

  $effect(() => {
    const next = position;
    untrack(() => {
      void app.adopt();
      const moved = app.ladder.filter((rung, index) => next[index] !== adopted[index]);
      adopted = next;
      if (moved.length === 0 || !app.graph.has(Router, app.app)) return;
      const router = app.resolve(Router);
      for (const rung of moved) void router.invalidate(rung.dependency);
    });
  });

  $effect(() => {
    if (!app.graph.has(Router, app.app)) return;
    const router = app.resolve(Router);
    const routeId = router.routeId;
    const arrived = router.status < 400;
    untrack(() => {
      if (arrived) app.land(routeId);
    });
  });

  if (owned) {
    $effect(() => () => {
      releaseApp(app);
      void app.close();
    });
  }

  return app;
}

export const App = {
  ...Core,

  mount<M extends LayerLike>(definition: Definition<M>, world: LayerLike = Layer.mergeAll()): MountedApp {
    const existing = currentApp(definition);
    return publish(existing ?? new MountedApp(definition, world, worldHooks), !existing);
  },

  attach(app: MountedApp): MountedApp {
    return publish(app, false);
  },

  override<Self>(key: KeyClass<string, Self>, value: Self): void {
    const parent = App.current();
    const child: MountedApp = Object.create(parent, {
      resolve: {
        value: <T>(requested: KeyClass<string, T>, from?: Scope): T =>
          (requested as unknown) === key ? (value as unknown as T) : parent.resolve(requested, from),
      },
      resolveDeferred: {
        value: <T>(requested: DeferredKeyClass<string, T>, from?: Scope): Promise<T> =>
          (requested as unknown) === key ? Promise.resolve(value as unknown as T) : parent.resolveDeferred(requested, from),
      },
      resolveHandle: {
        value: <T>(requested: DeferredKeyClass<string, T>, from?: Scope): Deferred<T> => {
          if ((requested as unknown) !== key) return parent.resolveHandle(requested, from);
          const ready = Promise.resolve(value as unknown as T);
          return { current: value as unknown as T, ready, then: (onFulfilled, onRejected) => ready.then(onFulfilled, onRejected) };
        },
      },
      find: {
        value: <T>(requested: KeyClass<string, T>, from?: Scope): T | Deferred<T> | undefined =>
          (requested as unknown) === key ? (value as unknown as T) : parent.find(requested, from),
      },
    });
    setContext(APP, child);
  },

  hold<R extends AnyRung>(rung: R, input: RungInput<R>): Scope {
    const parent = App.current();
    const above = getContext<Scope | undefined>(HELD);
    const held = parent.hold(rung, input, above);
    $effect(() => () => held.release());
    const child: MountedApp = Object.create(parent, {
      resolve: {
        value: <T>(requested: KeyClass<string, T>, from?: Scope): T => parent.resolve(requested, from ?? held.scope),
      },
      resolveDeferred: {
        value: <T>(requested: DeferredKeyClass<string, T>, from?: Scope): Promise<T> =>
          parent.resolveDeferred(requested, from ?? held.scope),
      },
      resolveHandle: {
        value: <T>(requested: DeferredKeyClass<string, T>, from?: Scope): Deferred<T> =>
          parent.resolveHandle(requested, from ?? held.scope),
      },
      find: {
        value: <T>(requested: KeyClass<string, T>, from?: Scope): T | Deferred<T> | undefined => parent.find(requested, from ?? held.scope),
      },
      scopeOf: {
        value: (tier: Tier, of?: string, from?: Scope): Scope => parent.scopeOf(tier, of, from ?? held.scope),
      },
    });
    setContext(APP, child);
    setContext(HELD, held.scope);
    return held.scope;
  },

  section(id: string, tier: Tier): Scope {
    const section = App.current().scopeOf(tier, id).child(id);
    onDestroy(() => void section.close());
    return section;
  },

  current(): MountedApp {
    const app = getContext<MountedApp | undefined>(APP);
    if (!app) throw new Error('App is not mounted above this component');
    return app;
  },
} as const;

bindAppResolver(() => App.current());
