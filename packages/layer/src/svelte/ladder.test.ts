import { flush } from '@runlith/testing/flush';
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import { App, RungClosedError } from '../App.js';
import HeldProbe from './test-utils/HeldProbe.svelte';
import HeldReach from './test-utils/HeldReach.svelte';
import { Failure } from '../Failure.js';
import { DuplicateProviderError, LayerTierError, TierMismatchError, UnknownTierError } from '../Graph.js';
import { Handoff } from '../Handoff.js';
import { Host } from '../Host.js';
import { Service } from '../key.js';
import { Layer } from '../Layer.js';
import { Rung } from '../Rung.js';
import { Scope } from '../Scope.js';
import { Visitor, type VisitorInput } from '../testing.js';
import { test as mountApp } from './test.svelte.js';

type RoomInput = { readonly id: string };
const Room = Rung.define<RoomInput>()('room', { keyOf: (room) => room.id, under: Visitor });
const Desk = Rung.define<RoomInput>()('desk', { keyOf: (desk) => desk.id, under: Visitor });

class Account extends Service<Account>()('Account', { tier: 'user' }) {
  static *make() {
    return new Account(yield* Visitor.Current);
  }
  constructor(readonly visitor: VisitorInput) {
    super();
  }
}

class Anyone extends Service<Anyone>()('Anyone', { tier: 'visitor' }) {
  static *make() {
    return new Anyone(yield* Scope);
  }
  constructor(readonly scope: Scope) {
    super();
  }
}

const roomEvents: string[] = [];

class Table extends Service<Table>()('Table', { tier: 'room', eager: true }) {
  static *make() {
    const room = yield* Room.Current;
    const scope = yield* Scope;
    roomEvents.push(`open:${room.id}`);
    scope.defer(() => void roomEvents.push(`close:${room.id}`));
    return new Table(room, scope);
  }
  constructor(
    readonly room: RoomInput,
    readonly scope: Scope,
  ) {
    super();
  }
}

describe('the ladder in the kernel', () => {
  it('a kind key resolves in a scope of its kind and refuses in the other; a rung key resolves in both', async () => {
    const asUser = mountApp(Layer.mergeAll(Account, Anyone), Layer.mergeAll(), {
      ladder: [Visitor],
      at: { visitor: Visitor.user('7') },
    });
    expect(asUser.get(Account).visitor.id).toBe('7');
    expect(asUser.get(Anyone).scope.home.name).toBe('visitor:user:7');
    await asUser.unmount();

    const asGuest = mountApp(Layer.mergeAll(Account, Anyone), Layer.mergeAll(), {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
    });
    expect(() => asGuest.get(Account)).toThrow(TierMismatchError);
    expect(asGuest.get(Anyone).scope.home.kind).toBe('guest');
    await asGuest.unmount();
  });

  it('a key naming a tier the ladder does not know is refused where the application is named', () => {
    class Stray extends Service<Stray>()('Stray', { tier: 'room' }) {
      static make(): Stray {
        return new Stray();
      }
    }
    expect(() => App.define(Layer.mergeAll(Stray), { ladder: [Visitor] })).toThrow(UnknownTierError);
    expect(() => App.define(Layer.mergeAll(Stray), { ladder: [Visitor] })).toThrow(/room/);
  });

  it('a rung is two keys: its Source above it, its Current at it, and the dependency a load declares', () => {
    expect(Room.Source.id).toBe('room.Source');
    expect(Room.Source.tier).toBe('app');
    expect(Room.Current.id).toBe('room');
    expect(Room.Current.tier).toBe('room');
    expect(Room.dependency).toBe('layer:room');
    expect(Visitor.kinds).toEqual(['user', 'guest']);
    expect(() => Rung.define<RoomInput, 'a'>()('broken', { keyOf: (r) => r.id, kindOf: () => 'a' })).toThrow(/kinds/);
  });
});

describe('a condition under the ladder', () => {
  it('is asked once, at the deepest scope that hosts every key it reads, and never at the app scope', async () => {
    const asked: string[] = [];
    let admitted = 0;
    class Admitted extends Service<Admitted>()('Admitted', { tier: 'user', eager: true }) {
      static make(): Admitted {
        admitted += 1;
        return new Admitted();
      }
    }
    const Gated = Layer.when(
      Account,
      (account) => {
        asked.push(account.visitor.id);
        return true;
      },
      Layer.mergeAll(Admitted),
    );

    const rt = mountApp(Layer.mergeAll(Account, Gated), Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: Visitor.user('7'), room: { id: 'a' } },
    });
    await flush();
    expect(new Set(asked)).toEqual(new Set(['7']));
    expect(admitted).toBe(1);
    await rt.unmount();
  });

  it('refuses at registration a condition reading two kinds of one rung', () => {
    class Teaser extends Service<Teaser>()('Teaser', { tier: 'guest' }) {
      static make(): Teaser {
        return new Teaser();
      }
    }
    const Impossible = Layer.when([Account, Teaser], () => true, Layer.mergeAll());
    expect(() =>
      mountApp(Layer.mergeAll(Account, Teaser, Impossible), Layer.mergeAll(), {
        ladder: [Visitor],
        at: { visitor: Visitor.guest() },
      }),
    ).toThrow(LayerTierError);
  });

  it('a condition reading a key of each rung is asked at the lower rung alone', async () => {
    const asked: string[] = [];
    let seats = 0;
    class Seat extends Service<Seat>()('Seat', { tier: 'room', eager: true }) {
      static make(): Seat {
        seats += 1;
        return new Seat();
      }
    }
    const Both = Layer.when(
      [Anyone, Table],
      (anyone, table) => {
        asked.push(`${anyone.scope.home.name}+${table.room.id}`);
        return true;
      },
      Layer.mergeAll(Seat),
    );

    const rt = mountApp(Layer.mergeAll(Anyone, Table, Both), Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: Visitor.guest(), room: { id: 'a' } },
    });
    await flush();
    expect(new Set(asked)).toEqual(new Set(['visitor:guest+a']));
    expect(seats).toBe(1);
    await rt.unmount();
  });

  it('refuses a key the condition would file above the scope that admitted it', () => {
    class Late extends Service<Late>()('Late', { tier: 'visitor' }) {
      static make(): Late {
        return new Late();
      }
    }
    const Both = Layer.when([Anyone, Table], () => true, Layer.mergeAll(Late));
    expect(() =>
      mountApp(Layer.mergeAll(Anyone, Table, Both), Layer.mergeAll(), {
        ladder: [Visitor, Room],
        at: { visitor: Visitor.guest(), room: { id: 'a' } },
      }),
    ).toThrow(LayerTierError);
  });
});

describe('the ladder in the mounted app', () => {
  it('moves a rung by handoff then adopt, closes the rung below with the one above, and refuses a closed rung', async () => {
    roomEvents.length = 0;
    const left: string[] = [];
    const rt = mountApp(Layer.mergeAll(Anyone, Table), Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: Visitor.user('7'), room: { id: 'a' } },
    });
    rt.get(Handoff).onLeave((rung) => left.push(rung));
    const tableA = rt.get(Table);
    expect(roomEvents).toEqual(['open:a']);
    expect(rt.app.scopeOf('room').name).toBe('visitor:user:7/room:a');

    rt.place('room', { id: 'b' });
    await flush();
    expect(left).toEqual(['room']);
    expect(rt.get(Table).room.id).toBe('b');
    expect(tableA.scope.closed).toBe(true);
    expect(roomEvents).toEqual(['open:a', 'open:b', 'close:a']);
    expect(rt.app.report().scopes.map((scope) => scope.name)).toEqual(['app', 'visitor:user:7', 'visitor:user:7/room:b']);

    rt.place('visitor', Visitor.user('8'));
    await flush();
    expect(left).toEqual(['room', 'visitor', 'room']);
    expect(roomEvents).toEqual(['open:a', 'open:b', 'close:a', 'open:b', 'close:b']);
    expect(rt.app.scopeOf('room').name).toBe('visitor:user:8/room:b');

    rt.place('room', undefined);
    await flush();
    expect(() => rt.get(Table)).toThrow(RungClosedError);
    expect(rt.app.scopeOf('visitor').name).toBe('visitor:user:8');
    await rt.unmount();
  });

  it("stands over a source the manifest carries: where the app stands is the test's own, and an unnamed rung is closed", async () => {
    const carried = Layer.mergeAll(
      Anyone,
      Table,
      Room.of(() => ({ id: 'manifest' })),
    );
    const rt = mountApp(carried, Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: Visitor.user('7'), room: { id: 'a' } },
    });
    expect(rt.get(Table).room.id).toBe('a');
    rt.place('room', { id: 'b' });
    await flush();
    expect(rt.get(Table).room.id).toBe('b');
    await rt.unmount();

    const unnamed = mountApp(carried, Layer.mergeAll(), { ladder: [Visitor, Room], at: { visitor: Visitor.user('7') } });
    expect(() => unnamed.get(Table)).toThrow(RungClosedError);
    await unnamed.unmount();
  });

  it('stands over ONE source the manifest carries, and leaves two of them to the kernel', () => {
    expect(() =>
      mountApp(
        Layer.mergeAll(
          Anyone,
          Table,
          Room.of(() => ({ id: 'one' })),
          Room.of(() => ({ id: 'two' })),
        ),
        Layer.mergeAll(),
        { ladder: [Visitor, Room], at: { visitor: Visitor.user('7'), room: { id: 'a' } } },
      ),
    ).toThrow(DuplicateProviderError);
  });

  it('leaves two failure readers of one manifest to the kernel, even when the test names its own', () => {
    expect(() =>
      mountApp(
        Layer.mergeAll(
          Anyone,
          Failure.of(() => undefined),
          Failure.of(() => undefined),
        ),
        Layer.mergeAll(),
        {
          ladder: [Visitor],
          at: { visitor: Visitor.user('7') },
          onFailure: () => undefined,
        },
      ),
    ).toThrow(DuplicateProviderError);
  });

  it('reports every open scope with what was built and what each build required', () => {
    class C extends Service<C>()('C', { tier: 'app' }) {
      static make(): C {
        return new C();
      }
    }
    class B extends Service<B>()('B', { tier: 'app' }) {
      static *make() {
        yield* C;
        return new B();
      }
    }
    class A extends Service<A>()('A', { tier: 'app' }) {
      static *make() {
        yield* B;
        yield* Scope;
        return new A();
      }
    }
    const rt = mountApp(Layer.mergeAll(A, B, C, Anyone), Layer.mergeAll(), {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
    });
    rt.get(A);
    rt.get(Anyone);
    const report = rt.app.report();
    const app = report.scopes.find((scope) => scope.name === 'app');
    const requires = new Map(app?.built.map((built) => [built.id, built.requires]));
    expect(requires.get('A')).toEqual(['B']);
    expect(requires.get('B')).toEqual(['C']);
    expect(requires.get('C')).toEqual([]);
    const visitor = report.scopes.find((scope) => scope.name === 'visitor:guest');
    expect(visitor?.kind).toBe('guest');
    expect(visitor?.built.map((built) => built.id)).toContain('Anyone');
    void rt.unmount();
  });

  it('Host is provided by the app that knows, and a tab that cannot tell says so', async () => {
    class Chrome extends Service<Chrome>()('Chrome', { tier: 'app' }) {
      static *make() {
        return new Chrome(yield* Host);
      }
      constructor(readonly host: Host) {
        super();
      }
    }
    // @ts-expect-error the manifest misses Host: nothing provides it
    const bare = mountApp(Layer.mergeAll(Chrome), Layer.mergeAll(), { data: 'lazy' });
    expect(() => bare.get(Chrome)).toThrow();
    await bare.unmount();
    const rt = mountApp(Layer.mergeAll(Chrome), Host.tab());
    expect(rt.get(Chrome).host.kind).toBe('tab');
    expect(rt.get(Chrome).host.os).toBe('unknown');
    expect(rt.get(Chrome).host.isDesktop).toBe(false);
    void rt.unmount();
  });
});

describe('the place of a scope is injective', () => {
  it('a key carrying the separators of the place opens its own scope, and closing it leaves the look-alike standing', async () => {
    const rt = mountApp(Layer.mergeAll(Anyone, Table), Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: Visitor.user('x/room:b'), room: { id: 'c' } },
    });
    const first = rt.app.scopeOf('room');
    expect(first.name).toBe('visitor:user:x%2Froom:b/room:c');

    rt.place('visitor', Visitor.user('x'));
    rt.place('room', { id: 'b/room:c' });
    await flush();
    const second = rt.app.scopeOf('room');
    expect(second).not.toBe(first);
    expect(second.name).toBe('visitor:user:x/room:b%2Froom:c');
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    await rt.unmount();
  });

  it('a rung name carrying a separator is refused where the rung is defined', () => {
    expect(() => Rung.define<RoomInput>()('a/b', { keyOf: (room) => room.id })).toThrow(/carries "\/" or ":"/);
    expect(() => Rung.define<RoomInput>()('a:b', { keyOf: (room) => room.id })).toThrow(/carries "\/" or ":"/);
  });
});

describe('a rung leaving', () => {
  it('a source answering nothing leaves once, however often the sources are read, and the closed scope is announced after its own keys released', async () => {
    roomEvents.length = 0;
    const left: string[] = [];
    const closed: string[] = [];
    const rt = mountApp(Layer.mergeAll(Anyone, Table), Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: Visitor.user('7'), room: { id: 'a' } },
    });
    const handoff = rt.get(Handoff);
    handoff.onLeave((rung) => left.push(rung));
    handoff.onClosed((scope) => closed.push(`${scope.name}:${roomEvents.join(',')}`));
    rt.get(Table);

    rt.place('room', undefined);
    await flush();
    rt.app.position();
    rt.app.position();
    expect(left).toEqual(['room']);
    expect(closed).toEqual(['visitor:user:7/room:a:open:a,close:a']);
    expect(rt.app.scopeOf('visitor').name).toBe('visitor:user:7');

    rt.place('room', { id: 'b' });
    await flush();
    rt.get(Table);
    rt.place('visitor', undefined);
    await flush();
    expect(left).toEqual(['room', 'visitor', 'room']);
    expect(closed.map((entry) => entry.split(':open')[0])).toEqual(['visitor:user:7/room:a', 'visitor:user:7/room:b', 'visitor:user:7']);
    expect(() => rt.app.scopeOf('visitor')).toThrow(RungClosedError);
    await rt.unmount();
  });
});

describe("how many scopes of a rung stand open is the application's", () => {
  it('two held scopes of one rung stay open through an adopt while the sources name one of them', async () => {
    roomEvents.length = 0;
    const left: string[] = [];
    const rt = mountApp(Layer.mergeAll(Anyone, Table), Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: Visitor.user('7'), room: { id: 'a' } },
    });
    rt.get(Handoff).onLeave((rung) => left.push(rung));
    const a = rt.app.hold('room', { id: 'a' });
    const b = rt.app.hold('room', { id: 'b' });
    expect(a.scope.name).toBe('visitor:user:7/room:a');
    expect(b.scope.name).toBe('visitor:user:7/room:b');
    expect(a.scope).toBe(rt.app.scopeOf('room'));
    await flush();
    await rt.app.adopt();
    expect(roomEvents).toEqual(['open:a', 'open:b']);
    expect(left).toEqual([]);

    rt.place('room', { id: 'b' });
    await flush();
    expect(rt.app.scopeOf('room')).toBe(b.scope);
    expect(roomEvents).toEqual(['open:a', 'open:b']);
    expect(left).toEqual([]);

    a.release();
    a.release();
    await flush();
    expect(left).toEqual(['room']);
    expect(roomEvents).toEqual(['open:a', 'open:b', 'close:a']);
    expect(b.scope.closed).toBe(false);

    b.release();
    await flush();
    await rt.app.adopt();
    expect(b.scope.closed).toBe(false);
    await rt.unmount();
  });

  it("a key resolved from a held chain answers that chain, not the sources' chain", async () => {
    const rt = mountApp(Layer.mergeAll(Anyone, Table), Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: Visitor.user('7'), room: { id: 'a' } },
    });
    const b = rt.app.hold('room', { id: 'b' });
    expect(rt.app.resolve(Table).room.id).toBe('a');
    expect(rt.app.resolve(Table, b.scope).room.id).toBe('b');
    expect(rt.app.resolve(Anyone, b.scope).scope.home.name).toBe('visitor:user:7');
    b.release();
    await rt.unmount();
  });

  it('a key of a rung the held chain does not reach refuses, and one standing under it answers', async () => {
    const rt = mountApp(Layer.mergeAll(Anyone, Table), Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: Visitor.user('7'), room: { id: 'a' } },
    });
    const beside = rt.app.hold('visitor', Visitor.user('9'));
    expect(() => rt.app.resolve(Table, beside.scope)).toThrow(TierMismatchError);
    const current = rt.app.hold('visitor', Visitor.user('7'));
    expect(rt.app.resolve(Table, current.scope).room.id).toBe('a');
    beside.release();
    current.release();
    await rt.unmount();
  });

  it("a component that holds a scope resolves and mounts in that scope's chain, and releases it with the component", async () => {
    roomEvents.length = 0;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const seen: { held: string; read: string; screen: string }[] = [];
    const definition = App.define(
      Layer.mergeAll(
        Anyone,
        Table,
        Visitor.of(() => Visitor.user('7')),
        Room.of(() => ({ id: 'a' })),
      ),
      { ladder: [Visitor, Room] },
    );
    const probe = mount(HeldProbe, {
      target,
      props: {
        definition,
        panes: [
          { rung: Room, input: { id: 'b' }, read: Table },
          { rung: Room, input: { id: 'c' }, read: Table },
        ],
        onScope: (index, held, read, screen) => {
          seen[index] = { held: held.name, read: read.name, screen: screen.parent?.name ?? '' };
        },
      },
    });
    await flush();
    expect(seen).toEqual([
      { held: 'visitor:user:7/room:b', read: 'visitor:user:7/room:b', screen: 'visitor:user:7/room:b' },
      { held: 'visitor:user:7/room:c', read: 'visitor:user:7/room:c', screen: 'visitor:user:7/room:c' },
    ]);
    expect(roomEvents).toEqual(['open:a', 'open:b', 'open:c']);

    await unmount(probe);
    await flush();
    expect(roomEvents.filter((event) => event.startsWith('close:')).sort()).toEqual(['close:a', 'close:b', 'close:c']);
    target.remove();
  });

  it('an app a held subtree sees answers in the scope its caller names, and in the held scope only when none is named', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const definition = App.define(
      Layer.mergeAll(
        Anyone,
        Table,
        Visitor.of(() => Visitor.user('7')),
        Room.of(() => ({ id: 'a' })),
      ),
      { ladder: [Visitor, Room] },
    );
    let home = '';
    const probe = mount(HeldReach, {
      target,
      props: { definition, rung: Room, held: { id: 'b' }, named: { id: 'c' }, read: Table, onRead: (name) => (home = name) },
    });
    await flush();
    expect(home).toBe('visitor:user:7/room:c');
    await unmount(probe);
    target.remove();
  });

  it("a held rung with no parent named opens under the sources' chain, and refuses when that chain does not reach it", async () => {
    const rt = mountApp(Layer.mergeAll(Anyone, Table), Layer.mergeAll(), {
      ladder: [Visitor, Room],
      at: { visitor: undefined },
    });
    expect(() => rt.app.hold('room', { id: 'a' })).toThrow(RungClosedError);
    const visitor = rt.app.hold('visitor', Visitor.user('9'));
    const room = rt.app.hold('room', { id: 'a' }, visitor.scope);
    expect(room.scope.name).toBe('visitor:user:9/room:a');
    room.release();
    visitor.release();
    await rt.unmount();
  });
});

describe('two rungs under one are siblings', () => {
  class Lamp extends Service<Lamp>()('Lamp', { tier: 'desk', eager: true }) {
    static *make() {
      return new Lamp(yield* Desk.Current, yield* Scope);
    }
    constructor(
      readonly desk: RoomInput,
      readonly scope: Scope,
    ) {
      super();
    }
  }

  it('moving one leaves the other standing, a key of one refuses from the other, and their parent takes both', async () => {
    const left: string[] = [];
    const rt = mountApp(Layer.mergeAll(Anyone, Table, Lamp), Layer.mergeAll(), {
      ladder: [Visitor, Room, Desk],
      at: { visitor: Visitor.user('7'), room: { id: 'a' }, desk: { id: 'd' } },
    });
    rt.get(Handoff).onLeave((rung) => left.push(rung));
    const lamp = rt.get(Lamp);
    expect(lamp.scope.home.name).toBe('visitor:user:7/desk:d');
    expect(rt.get(Table).scope.home.name).toBe('visitor:user:7/room:a');

    rt.place('room', { id: 'b' });
    await flush();
    expect(left).toEqual(['room']);
    expect(rt.get(Lamp)).toBe(lamp);
    expect(lamp.scope.closed).toBe(false);

    rt.place('room', undefined);
    await flush();
    expect(rt.get(Lamp)).toBe(lamp);
    expect(() => rt.app.resolve(Table, lamp.scope)).toThrow(TierMismatchError);

    rt.place('visitor', undefined);
    await flush();
    expect(lamp.scope.closed).toBe(true);
    await rt.unmount();
  });

  it('a held chain reads a sibling rung where its sources stand under the parent they share, and refuses one under another parent', async () => {
    const rt = mountApp(Layer.mergeAll(Anyone, Table, Lamp), Layer.mergeAll(), {
      ladder: [Visitor, Room, Desk],
      at: { visitor: Visitor.user('7'), room: { id: 'a' }, desk: { id: 'd' } },
    });
    const beside = rt.app.hold('desk', { id: 'e' });
    expect(rt.app.resolve(Table, beside.scope).room.id).toBe('a');
    expect(rt.app.resolve(Lamp, beside.scope).desk.id).toBe('e');

    const visitor = rt.app.hold('visitor', Visitor.user('9'));
    const elsewhere = rt.app.hold('desk', { id: 'e' }, visitor.scope);
    expect(() => rt.app.resolve(Table, elsewhere.scope)).toThrow(TierMismatchError);
    elsewhere.release();
    visitor.release();
    beside.release();
    await rt.unmount();
  });

  it('a held scope of another kind of the same rung reads none of the kind its sources stand at', async () => {
    const rt = mountApp(Layer.mergeAll(Account, Anyone), Layer.mergeAll(), {
      ladder: [Visitor],
      at: { visitor: Visitor.user('7') },
    });
    const guest = rt.app.hold('visitor', Visitor.guest());
    expect(() => rt.app.resolve(Account, guest.scope)).toThrow(TierMismatchError);
    guest.release();
    await rt.unmount();
  });

  it('a rung listed before the rung it stands under is refused where the application is named', () => {
    expect(() => App.define(Layer.mergeAll(), { ladder: [Room, Visitor] })).toThrow(/does not list before it/);
    expect(() => App.define(Layer.mergeAll(), { ladder: [Room] })).toThrow(/does not list before it/);
  });
});

describe('a condition over a rung and one of its kinds', () => {
  it('is admitted, and asked at the kind scope', async () => {
    const asked: string[] = [];
    let admitted = 0;
    class Admitted extends Service<Admitted>()('Admitted', { tier: 'user', eager: true }) {
      static make(): Admitted {
        admitted += 1;
        return new Admitted();
      }
    }
    const Both = Layer.when(
      [Anyone, Account],
      (anyone, account) => {
        asked.push(`${anyone.scope.home.name}+${account.visitor.id}`);
        return true;
      },
      Layer.mergeAll(Admitted),
    );
    const rt = mountApp(Layer.mergeAll(Anyone, Account, Both), Layer.mergeAll(), {
      ladder: [Visitor],
      at: { visitor: Visitor.user('7') },
    });
    await flush();
    expect(new Set(asked)).toEqual(new Set(['visitor:user:7+7']));
    expect(admitted).toBe(1);
    await rt.unmount();
  });
});
