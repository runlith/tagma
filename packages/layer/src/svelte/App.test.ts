import { flush } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Clock } from '../clock.js';
import {
  DependencyCycleError,
  DuplicateProviderError,
  KeyIdCollisionError,
  MissingRecipeError,
  ServiceStartError,
  TierMismatchError,
} from '../Graph.js';
import { Service, type Resolver } from '../key.js';
import { Layer } from '../Layer.js';
import { Rung } from '../Rung.js';
import { Scope, ScopeAbort } from '../Scope.js';
import { Visitor, type VisitorInput } from '../testing.js';
import { test as mountApp } from './test.svelte.js';

class Boot extends Service<Boot>()('Boot', { tier: 'app' }) {
  constructor(readonly brand: string) {
    super();
  }
}

class Repo extends Service<Repo>()('Repo', { tier: 'app' }) {
  static *make() {
    return new Repo(yield* Boot);
  }
  constructor(readonly boot: Boot) {
    super();
  }
}

class Profile extends Service<Profile>()('Profile', { tier: 'user' }) {
  static *make() {
    return new Profile(yield* Visitor.Current, yield* Repo, yield* Scope);
  }
  constructor(
    readonly session: VisitorInput,
    readonly repo: Repo,
    readonly scope: Scope,
  ) {
    super();
  }
}

class Teaser extends Service<Teaser>()('Teaser', { tier: 'guest' }) {
  static *make() {
    return new Teaser(yield* Scope);
  }
  constructor(readonly scope: Scope) {
    super();
  }
}

const built: string[] = [];

class Behaviour extends Service<Behaviour>()('Behaviour', { tier: 'user', eager: true }) {
  static *make() {
    const scope = yield* Scope;
    built.push(`behaviour:${scope.home.name}`);
    return new Behaviour(scope);
  }
  readonly ticks: number[] = [];
  constructor(readonly scope: Scope) {
    super();
    Clock.after(scope, 50, () => this.ticks.push(Clock.now()));
    scope.defer(() => {
      built.push(`behaviour-finalizer:${scope.signal.aborted}`);
    });
  }
}

class Late extends Service<Late>()('Late', { tier: 'app' }) {
  static *make() {
    return new Late(yield* Scope);
  }
  constructor(readonly scope: Scope) {
    super();
  }
}

class Data extends Service<Data>()('Data', { tier: 'user' }) {
  static *make() {
    yield* Visitor.Current;
    built.push('data');
    return new Data();
  }
}

const Manifest = Layer.mergeAll(Repo, Profile, Teaser, Behaviour, Data);
const boot = Layer.of(Boot, new Boot('acme'));

afterEach(() => {
  vi.useRealTimers();
});

describe('App', () => {
  it('observes only existing rung scopes under their parent without opening them', async () => {
    const Room = Rung.define<{ readonly id: string }>()('room', { under: Visitor, keyOf: ({ id }) => id });
    const rt = mountApp(Layer.mergeAll(), Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: Visitor.user('1') },
    });
    const input = Visitor.user('2');
    const room = { id: 'room-1' };
    expect(rt.app.hasScope(Visitor, input)).toBe(false);
    const parent = rt.app.hold(Visitor, input);
    expect(rt.app.hasScope(Visitor, input)).toBe(true);
    expect(rt.app.hasScope(Room, room, parent.scope)).toBe(false);
    const child = rt.app.hold(Room, room, parent.scope);
    expect(rt.app.hasScope(Room, room, parent.scope)).toBe(true);
    expect(rt.app.hasScope(Room, room)).toBe(false);
    child.release();
    await rt.app.adopt();
    expect(rt.app.hasScope(Room, room, parent.scope)).toBe(false);
    parent.release();
    await rt.app.adopt();
    expect(rt.app.hasScope(Visitor, input)).toBe(false);
    await rt.unmount();
    expect(rt.app.hasScope(Visitor, Visitor.user('1'))).toBe(false);
  });

  it('builds the graph through generators and memoizes per scope', async () => {
    const rt = mountApp(Manifest, boot, { ladder: [Visitor], at: { visitor: Visitor.user('7') } });
    const profile = rt.get(Profile);
    expect(profile.repo.boot.brand).toBe('acme');
    expect(profile.session.id).toBe('7');
    expect(rt.get(Profile)).toBe(profile);
    expect(rt.get(Repo)).toBe(profile.repo);
    expect(profile.scope.home).toBe(rt.app.scopeOf('visitor'));
    expect(profile.scope.home.kind).toBe('user');
    await rt.unmount();
  });

  it('refuses a user-tier service in a guest session and builds the guest tier instead', async () => {
    const rt = mountApp(Manifest, boot, { ladder: [Visitor], at: { visitor: Visitor.guest() } });
    expect(() => rt.get(Profile)).toThrow(TierMismatchError);
    expect(rt.get(Teaser).scope.home.kind).toBe('guest');
    await rt.unmount();
  });

  it('refuses a cycle and two different providers of one key; the same key from two directions is reuse', async () => {
    class A extends Service<A>()('A', { tier: 'app' }) {
      static *make() {
        yield* B;
        return new A();
      }
    }
    class B extends Service<B>()('B', { tier: 'app' }) {
      static *make() {
        yield* A;
        return new B();
      }
    }
    const cyclic = mountApp(Layer.mergeAll(A, B), Layer.mergeAll(), { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' });
    expect(() => cyclic.get(A)).toThrow(DependencyCycleError);
    await cyclic.unmount();
    expect(() =>
      mountApp(
        Layer.mergeAll(
          Repo,
          Layer.provide(Repo, function* () {
            return new Repo(yield* Boot);
          }),
        ),
        boot,
        { ladder: [Visitor], at: { visitor: Visitor.guest() } },
      ),
    ).toThrow(DuplicateProviderError);
    const rt = mountApp(Layer.mergeAll(Repo, Layer.mergeAll(Repo, Teaser)), boot, { ladder: [Visitor], at: { visitor: Visitor.guest() } });
    expect(rt.get(Repo).boot.brand).toBe('acme');
    await rt.unmount();
  });

  it('a key that throws as its scope starts leaves its siblings standing, and they end with the scope', async () => {
    const events: string[] = [];
    class First extends Service<First>()('First', { tier: 'user', eager: true }) {
      static *make() {
        const scope = yield* Scope;
        scope.defer(() => {
          events.push('first-finalizer');
        });
        return new First();
      }
    }
    class Broken extends Service<Broken>()('Broken', { tier: 'user', eager: true }) {
      static make(): Broken {
        throw new Error('broken make');
      }
    }

    const failures: unknown[] = [];
    const rt = mountApp(Layer.mergeAll(First, Broken), boot, {
      ladder: [Visitor],
      at: { visitor: Visitor.user('1') },
      onFailure: (error) => failures.push(error),
    });
    expect(rt.get(First)).toBeInstanceOf(First);
    expect(failures.map((error) => (error as ServiceStartError).id)).toEqual(['Broken']);
    expect(events).toEqual([]);

    await rt.unmount();
    expect(events).toEqual(['first-finalizer']);
  });

  it('derives the session from an app-tier key and refuses any other tier in the callback', async () => {
    class Config extends Service<Config>()('Config', { tier: 'app' }) {
      static make(): Config {
        return new Config(Visitor.user('42'));
      }
      constructor(readonly input: VisitorInput) {
        super();
      }
    }

    const rt = mountApp(Layer.mergeAll(Config), Layer.mergeAll(), {
      ladder: [Visitor],
      at: { visitor: (app: Resolver) => app.resolve(Config).input },
    });
    expect(rt.app.scopeOf('visitor').name).toBe('visitor:user:42');
    await rt.unmount();

    expect(() =>
      mountApp(Manifest, boot, {
        ladder: [Visitor],
        at: {
          visitor: (app: Resolver) => {
            app.resolve(Profile);
            return Visitor.guest();
          },
        },
      }),
    ).toThrow(/app-tier keys only/);
  });

  it('starts eager behaviour at session open and ends it with the session', async () => {
    vi.useFakeTimers();
    built.length = 0;
    const rt = mountApp(Manifest, boot, { ladder: [Visitor], at: { visitor: Visitor.user('1') }, data: 'lazy' });
    expect(built).toEqual(['behaviour:visitor:user:1']);
    const behaviour = rt.get(Behaviour);
    const userScope = rt.app.scopeOf('visitor');

    rt.place('visitor', Visitor.guest());
    flushSync();
    await rt.app.adopt();
    expect(userScope.closed).toBe(true);
    expect(userScope.signal.aborted).toBe(true);
    expect(built).toContain('behaviour-finalizer:true');

    await vi.advanceTimersByTimeAsync(50);
    expect(behaviour.ticks).toEqual([]);
    expect(rt.app.scopeOf('visitor').kind).toBe('guest');
    await rt.unmount();
  });

  it('a session timer fires while the session is open', async () => {
    vi.useFakeTimers();
    built.length = 0;
    const rt = mountApp(Manifest, boot, { ladder: [Visitor], at: { visitor: Visitor.user('1') }, data: 'lazy' });
    const behaviour = rt.get(Behaviour);

    await vi.advanceTimersByTimeAsync(50);
    expect(behaviour.ticks).toHaveLength(1);
    await rt.unmount();
  });

  it('builds data services whole when eager and on first use when lazy', async () => {
    built.length = 0;
    const lazy = mountApp(Manifest, boot, { ladder: [Visitor], at: { visitor: Visitor.user('1') }, data: 'lazy' });
    expect(built.filter((entry) => entry === 'data')).toHaveLength(0);
    lazy.get(Data);
    expect(built.filter((entry) => entry === 'data')).toHaveLength(1);
    await lazy.unmount();

    built.length = 0;
    const eager = mountApp(Manifest, boot, { ladder: [Visitor], at: { visitor: Visitor.user('1') }, data: 'eager' });
    expect(built.filter((entry) => entry === 'data')).toHaveLength(1);
    await eager.unmount();
  });

  it('includes a deferred layer once its chunk arrives and only when the condition holds', async () => {
    built.length = 0;
    let enabled = true;
    const Deferred = Layer.when(
      () => enabled,
      () => Promise.resolve({ default: Layer.mergeAll(Behaviour) }),
    );
    const WithDeferred = Layer.mergeAll(Repo, Profile, Teaser, Data, Deferred);

    const on = mountApp(WithDeferred, boot, { ladder: [Visitor], at: { visitor: Visitor.user('1') }, data: 'lazy' });
    expect(built).toEqual([]);
    await flush();
    expect(built).toEqual(['behaviour:visitor:user:1']);
    await on.unmount();

    built.length = 0;
    enabled = false;
    const off = mountApp(WithDeferred, boot, { ladder: [Visitor], at: { visitor: Visitor.user('1') }, data: 'lazy' });
    await flush();
    expect(built).toEqual([]);
    expect(() => off.get(Behaviour)).toThrow();
    await off.unmount();
  });

  it('an app-tier service inside a session-gated layer stays reachable from the app scope', async () => {
    built.length = 0;
    let signedIn = false;
    const Gated = Layer.when(
      () => signedIn,
      () => Promise.resolve({ default: Layer.mergeAll(Late) }),
    );

    const rt = mountApp(Layer.mergeAll(Repo, Profile, Gated), boot, {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
      data: 'lazy',
    });
    await flush();
    expect(() => rt.get(Late)).toThrow();

    signedIn = true;
    rt.place('visitor', Visitor.user('1'));
    await flush();

    expect(rt.get(Late).scope.home.tier).toBe('app');
    await rt.unmount();
  });

  it('loads a deferred chunk once, however many scopes open', async () => {
    let loads = 0;
    const Counted = Layer.when(
      () => true,
      () => {
        loads += 1;
        return Promise.resolve({ default: Layer.mergeAll(Late) });
      },
    );

    const rt = mountApp(Layer.mergeAll(Repo, Profile, Counted), boot, {
      ladder: [Visitor],
      at: { visitor: Visitor.user('1') },
      data: 'lazy',
    });
    await flush();
    rt.place('visitor', Visitor.user('2'));
    await flush();

    expect(loads).toBe(1);
    await rt.unmount();
  });

  it('takes a recipe for a key its own package cannot build', async () => {
    class Port extends Service<Port>()('Port', { tier: 'app' }) {
      constructor(readonly brand: string) {
        super();
      }
    }

    const rt = mountApp(
      Layer.mergeAll(
        Repo,
        Layer.provide(Port, function* () {
          return new Port((yield* Boot).brand);
        }),
      ),
      boot,
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );

    expect(rt.get(Port).brand).toBe('acme');
    expect(() => mountApp(Layer.mergeAll(Repo), boot, { ladder: [Visitor], at: { visitor: Visitor.guest() } }).get(Port)).toThrow();
    await rt.unmount();
  });

  it('refuses a key that carries no recipe at mount, by name', () => {
    class Bare extends Service<Bare>()('Bare', { tier: 'app' }) {}

    // @ts-expect-error the type refuses it first; the door keeps its own refusal for a caller whose types were erased
    expect(() => mountApp(Layer.mergeAll(Bare), Layer.mergeAll(), { ladder: [Visitor], at: { visitor: Visitor.guest() } })).toThrow(
      MissingRecipeError,
    );
    const rt = mountApp(Layer.mergeAll(), Layer.of(Bare, new (class extends Bare {})()), {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
    });
    expect(rt.get(Bare)).toBeDefined();
    void rt.unmount();
  });

  it('hands a deferred chunk failure to the failure sink instead of losing it', async () => {
    const failures: unknown[] = [];
    const Broken = Layer.when(
      () => true,
      () => Promise.reject(new Error('chunk 404')),
    );

    const rt = mountApp(Layer.mergeAll(Repo, Broken), boot, {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
      data: 'lazy',
      onFailure: (error) => failures.push(error),
    });
    await rt.app.ready;
    await flush();

    expect(failures).toHaveLength(2);
    expect(failures.map((error) => (error as Error).message)).toEqual(['chunk 404', 'chunk 404']);
    await rt.unmount();
  });

  it('a chunk still in flight when the session recycles is not a failure', async () => {
    const failures: unknown[] = [];
    let loads = 0;
    let release: (() => void) | undefined;
    const Slow = Layer.when(
      () => true,
      () => {
        loads += 1;
        return new Promise<{ default: typeof Manifest }>((resolve) => {
          release = () => resolve({ default: Layer.mergeAll(Data) });
        });
      },
    );

    const rt = mountApp(Layer.mergeAll(Repo, Profile, Slow), boot, {
      ladder: [Visitor],
      at: { visitor: Visitor.user('1') },
      data: 'lazy',
      onFailure: (error) => failures.push(error),
    });
    const first = rt.app.scopeOf('visitor');
    expect(loads).toBe(1);

    rt.place('visitor', Visitor.user('2'));
    await flush();
    expect(first.closed).toBe(true);

    release?.();
    await flush();
    expect(failures).toEqual([]);
    expect(rt.get(Data)).toBeInstanceOf(Data);
    await rt.unmount();
  });

  it('refuses to build in a scope that has already closed', async () => {
    const rt = mountApp(Manifest, boot, { ladder: [Visitor], at: { visitor: Visitor.user('1') }, data: 'lazy' });
    const userScope = rt.app.scopeOf('visitor');
    await userScope.close();

    expect(() => rt.app.graph.resolve(Data, userScope)).toThrow(ScopeAbort);
    expect(userScope.finalizers).toHaveLength(0);
    await rt.unmount();
  });
});

describe('a key that fails as its scope starts', () => {
  function failing<const Tr extends 'app' | 'user'>(id: string, tier: Tr, count: { attempts: number }) {
    return class extends Service<object>()(id, { tier, eager: true }) {
      static make(): object {
        count.attempts += 1;
        throw new Error(`${id} refused`);
      }
    };
  }

  it('is reported by its id and left unbuilt; the rung opens, and the explicit door throws and asks again', async () => {
    built.length = 0;
    const count = { attempts: 0 };
    const Broken = failing('Broken', 'user', count);
    const failures: unknown[] = [];
    const rt = mountApp(Layer.mergeAll(Manifest, Broken), boot, {
      ladder: [Visitor],
      at: { visitor: Visitor.user('1') },
      data: 'lazy',
      onFailure: (error) => failures.push(error),
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(ServiceStartError);
    expect((failures[0] as ServiceStartError).id).toBe('Broken');
    expect(((failures[0] as ServiceStartError).cause as Error).message).toBe('Broken refused');
    expect(built).toEqual(['behaviour:visitor:user:1']);
    expect(rt.get(Profile).session.id).toBe('1');

    expect(() => rt.get(Broken)).toThrow('Broken refused');
    expect(() => rt.get(Broken)).toThrow('Broken refused');
    expect(count.attempts).toBe(3);
    expect(failures).toHaveLength(1);
    await rt.unmount();
  });

  it('an app-tier key that fails leaves the application mounted', async () => {
    const Broken = failing('BrokenApp', 'app', { attempts: 0 });
    const failures: unknown[] = [];
    const rt = mountApp(Layer.mergeAll(Repo, Broken), boot, {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
      onFailure: (error) => failures.push(error),
    });

    expect(failures.map((error) => (error as ServiceStartError).id)).toEqual(['BrokenApp']);
    expect(rt.get(Repo).boot.brand).toBe('acme');
    await rt.unmount();
  });

  it('reports every eager key that depends on the failed one on its own', async () => {
    const Root = failing('Root', 'app', { attempts: 0 });
    class Middle extends Service<Middle>()('Middle', { tier: 'app', eager: true }) {
      static *make() {
        yield* Root;
        return new Middle();
      }
    }
    class Leaf extends Service<Leaf>()('Leaf', { tier: 'user', eager: true }) {
      static *make() {
        yield* Middle;
        return new Leaf();
      }
    }
    const failures: unknown[] = [];
    const rt = mountApp(Layer.mergeAll(Leaf, Middle, Root), boot, {
      ladder: [Visitor],
      at: { visitor: Visitor.user('1') },
      data: 'lazy',
      onFailure: (error) => failures.push(error),
    });

    const ids = failures.map((error) => (error as ServiceStartError).id);
    expect([...ids].sort()).toEqual(['Leaf', 'Middle', 'Root']);
    const causes = failures.map((error) => ((error as ServiceStartError).cause as Error).message);
    expect(causes).toEqual(['Root refused', 'Root refused', 'Root refused']);
    await rt.unmount();
  });

  it('a key a chunk brings in is isolated the same way', async () => {
    built.length = 0;
    const Broken = failing('BrokenInChunk', 'user', { attempts: 0 });
    const failures: unknown[] = [];
    const rt = mountApp(
      Layer.mergeAll(
        Repo,
        Profile,
        Layer.when(
          () => true,
          () => Promise.resolve({ default: Layer.mergeAll(Broken, Behaviour) }),
        ),
      ),
      boot,
      { ladder: [Visitor], at: { visitor: Visitor.user('1') }, data: 'lazy', onFailure: (error) => failures.push(error) },
    );
    await flush();

    expect(failures.map((error) => (error as ServiceStartError).id)).toEqual(['BrokenInChunk']);
    expect(built).toEqual(['behaviour:visitor:user:1']);
    await rt.unmount();
  });

  it('a cycle among eager keys is reported by name, and the scope still opens', async () => {
    class Ping extends Service<Ping>()('Ping', { tier: 'app', eager: true }) {
      static *make() {
        yield* Pong;
        return new Ping();
      }
    }
    class Pong extends Service<Pong>()('Pong', { tier: 'app', eager: true }) {
      static *make() {
        yield* Ping;
        return new Pong();
      }
    }
    const failures: unknown[] = [];
    const rt = mountApp(Layer.mergeAll(Ping, Pong, Repo), boot, {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
      onFailure: (error) => failures.push(error),
    });

    expect(failures.map((error) => (error as ServiceStartError).cause)).toEqual([
      expect.any(DependencyCycleError),
      expect.any(DependencyCycleError),
    ]);
    expect(rt.get(Repo).boot.brand).toBe('acme');
    await rt.unmount();
  });
});

describe('two keys under one id', () => {
  function twin() {
    return class extends Service<{ readonly n: number }>()('Twin', { tier: 'app' }) {
      static make() {
        return { n: 1 };
      }
    };
  }

  it('are refused when the manifest names both', () => {
    expect(() => mountApp(Layer.mergeAll(twin(), twin()), boot, { ladder: [Visitor], at: { visitor: Visitor.guest() } })).toThrow(
      KeyIdCollisionError,
    );
  });

  it('are refused when a chunk brings the second, and the failure is reported', async () => {
    const failures: unknown[] = [];
    const rt = mountApp(
      Layer.mergeAll(
        twin(),
        Layer.when(
          () => true,
          () => Promise.resolve({ default: Layer.mergeAll(twin()) }),
        ),
      ),
      boot,
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy', onFailure: (error) => failures.push(error) },
    );
    await rt.app.ready;
    await flush();

    expect(failures).toEqual([expect.any(KeyIdCollisionError), expect.any(KeyIdCollisionError)]);
    await rt.unmount();
  });
});

describe('Scope.close', () => {
  it('aborts before finalizers and rejects what they await', async () => {
    const scope = Scope.make('s');
    const order: string[] = [];
    scope.defer(async () => {
      order.push(`first:${scope.signal.aborted}`);
      await expect(scope.await(Promise.resolve(1))).rejects.toBeInstanceOf(ScopeAbort);
    });
    scope.defer(() => {
      order.push('second');
    });
    await scope.close();
    await scope.close();
    expect(order).toEqual(['second', 'first:true']);
  });
});
