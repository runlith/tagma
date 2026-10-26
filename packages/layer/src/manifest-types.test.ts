import { describe, expect, it } from 'vitest';

import type { ClosedBy } from './App.js';
import { Service, type Provided } from './key.js';
import { Layer, type LayerLike } from './Layer.js';
import { Rung } from './Rung.js';
import { Visitor } from './testing.js';

type RoomInput = { readonly id: string };

const Room = Rung.define<RoomInput>()('room', { keyOf: (room) => room.id, under: Visitor });

type Ladder = readonly [typeof Visitor, typeof Room];

function closed<M extends LayerLike>(
  manifest: M & ClosedBy<M, Layer<Provided<typeof Visitor.Source> | Provided<typeof Room.Source>, never>, Ladder>,
): M {
  return manifest;
}

class Account extends Service<Account>()('Types.Account', { tier: 'user' }) {
  static make(): Account {
    return new Account();
  }
}

class Visit extends Service<Visit>()('Types.Visit', { tier: 'visitor' }) {
  static make(): Visit {
    return new Visit();
  }
}

class Seat extends Service<Seat>()('Types.Seat', { tier: 'room' }) {
  static make(): Seat {
    return new Seat();
  }
}

class Lamp extends Service<Lamp>()('Types.Lamp', { tier: 'desk' }) {
  static make(): Lamp {
    return new Lamp();
  }
}

class Clock extends Service<Clock>()('Types.Clock', { tier: 'app' }) {
  static make(): Clock {
    return new Clock();
  }
}

class Day extends Service<Day>()('Types.Day', { tier: 'user' }) {
  static make(): Day {
    return new Day();
  }
}

class Calendar extends Service<Calendar>()('Types.Calendar', { tier: 'user' }) {
  static *make() {
    yield* Day;
    return new Calendar();
  }
}

class Toggles extends Service<Toggles>()('Types.Toggles', { tier: 'app' }) {
  readonly on = true;
  readonly other = false;
}

const world = Layer.mergeAll(Layer.of(Toggles, new Toggles()));

describe('a key provided under a condition', () => {
  it('closes no requirement that stands without it', () => {
    // @ts-expect-error the calendar stands for every signed-in visitor, the day only while a rung's kind is present
    closed(Layer.mergeAll(world, Calendar, Layer.when(Visitor.present('user'), Day)));
    closed(
      // @ts-expect-error nor under a flag
      Layer.mergeAll(
        world,
        Calendar,
        Layer.when(Toggles, (toggles) => toggles.on, Day),
      ),
    );
    expect(closed).toBeTypeOf('function');
  });

  it('closes a requirement under the same named condition, or under that one and more', () => {
    expect(
      closed(Layer.mergeAll(world, Layer.when(Visitor.present('user'), Calendar), Layer.when(Visitor.present('user'), Day))),
    ).toBeDefined();
    expect(
      closed(
        Layer.mergeAll(
          world,
          Layer.when(
            Visitor.present('user'),
            Layer.when(Toggles, (toggles) => toggles.on, Calendar),
          ),
          Layer.when(Visitor.present('user'), Day),
        ),
      ),
    ).toBeDefined();
  });

  it('never closes a requirement under another unnamed condition, since no two predicates are known to agree', () => {
    const calendar = Layer.when(Toggles, (toggles) => toggles.on, Calendar);
    const day = Layer.when(Toggles, (toggles) => toggles.other, Day);
    // @ts-expect-error `on` and `other` are two predicates: the day may be missing while the calendar stands
    closed(Layer.mergeAll(world, calendar, day));
    expect(closed(Layer.mergeAll(world, calendar, Day))).toBeDefined();
  });

  it('under one kind of a rung closes nothing under the other kind', () => {
    // @ts-expect-error a guest's presence is not a signed-in visitor's
    closed(Layer.mergeAll(world, Layer.when(Visitor.present('user'), Calendar), Layer.when(Visitor.present('guest'), Day)));
  });
});

describe('the keys a condition reads', () => {
  it('are the manifest’s to provide, whatever the condition admits', () => {
    // @ts-expect-error the condition reads Toggles, and nothing provides it
    closed(Layer.mergeAll(Layer.when(Toggles, (toggles) => toggles.on, Day)));
    expect(
      closed(
        Layer.mergeAll(
          world,
          Layer.when(Toggles, (toggles) => toggles.on, Day),
        ),
      ),
    ).toBeDefined();
  });
});

describe('a key reaches only what its tier can on the ladder', () => {
  it('refuses an app key asking a rung’s, and a rung key asking one of its kinds’', () => {
    class Wallet extends Service<Wallet>()('Types.Wallet', { tier: 'app' }) {
      static *make() {
        yield* Visit;
        return new Wallet();
      }
    }
    class Greeting extends Service<Greeting>()('Types.Greeting', { tier: 'visitor' }) {
      static *make() {
        yield* Account;
        return new Greeting();
      }
    }
    // @ts-expect-error an app-tier key outlives every visitor scope: a visitor's key is not there to take
    closed(Layer.mergeAll(Visit, Wallet));
    // @ts-expect-error a visitor key is built for a guest too, and a guest has no account
    closed(Layer.mergeAll(Account, Greeting));
    expect(closed).toBeTypeOf('function');
  });

  it('refuses a key asking a rung below its own or beside it, and a recipe written for someone else’s key', () => {
    class Host extends Service<Host>()('Types.Host', { tier: 'visitor' }) {
      static *make() {
        yield* Seat;
        return new Host();
      }
    }
    class Chair extends Service<Chair>()('Types.Chair', { tier: 'room' }) {
      static *make() {
        yield* Lamp;
        return new Chair();
      }
    }
    class Port extends Service<Port>()('Types.Port', { tier: 'app' }) {}
    // @ts-expect-error a room is opened under a visitor: the visitor scope has no room to read
    closed(Layer.mergeAll(Seat, Host));
    // @ts-expect-error a desk stands beside the room, never above it
    closed(Layer.mergeAll(Lamp, Chair));
    const fromSeat = Layer.provide(Port, function* () {
      yield* Seat;
      return new Port();
    });
    // @ts-expect-error the recipe is the key's: an app-tier port cannot be built from a room's seat
    closed(Layer.mergeAll(Seat, fromSeat));
  });

  it('lets a narrower key take what lives above it: its rung, the rungs its rung stands under, and the app', () => {
    class Statement extends Service<Statement>()('Types.Statement', { tier: 'user' }) {
      static *make() {
        yield* Account;
        yield* Visit;
        yield* Clock;
        return new Statement();
      }
    }
    class Bench extends Service<Bench>()('Types.Bench', { tier: 'room' }) {
      static *make() {
        yield* Seat;
        yield* Visit;
        yield* Clock;
        return new Bench();
      }
    }
    expect(closed(Layer.mergeAll(Account, Visit, Clock, Statement, Seat, Bench))).toBeDefined();
  });

  it('refuses a rung source reading anything but the app, and a rung standing where the ladder does not put it', () => {
    closed(
      // @ts-expect-error a source says which scope to open, so it reads only what stands before any scope
      Layer.mergeAll(
        Visit,
        Room.from(Visit, () => ({ id: 'a' })),
      ),
    );
    // @ts-expect-error the ladder puts the room under the visitor
    const stray = Rung.define<RoomInput>()('room', { keyOf: (room) => room.id });
    expect(stray.name).toBe('room');
  });
});
