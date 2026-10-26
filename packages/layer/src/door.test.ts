import { describe, expect, it } from 'vitest';

import type { BuildDoorOn, FindDoorOn, GroundOf, UseDoorOn } from './door.js';
import { Service } from './key.js';
import { Layer } from './Layer.js';
import { Platform } from './Platform.js';
import { Router } from './Router.js';
import { Scope } from './Scope.js';
import { Visitor } from './testing.js';

class Toggles extends Service<Toggles>()('Doors.Toggles', { tier: 'app' }) {
  readonly on = true;
}

class Clock extends Service<Clock>()('Doors.Clock', { tier: 'app' }) {
  static make(): Clock {
    return new Clock();
  }
}

class Day extends Service<Day>()('Doors.Day', { tier: 'app' }) {
  static make(): Day {
    return new Day();
  }
}

class Lobby extends Service<Lobby>()('Doors.Lobby', { tier: 'hall' }) {
  static make(): Lobby {
    return new Lobby();
  }
}

class Visit extends Service<Visit>()('Doors.Visit', { tier: 'visitor' }) {
  static make(): Visit {
    return new Visit();
  }
}

class Account extends Service<Account>()('Doors.Account', { tier: 'user' }) {
  static make(): Account {
    return new Account();
  }
}

class Card extends Service<Card>()('Doors.Card', { tier: 'user' }) {
  static make(): Card {
    return new Card();
  }
}

class Chair extends Service<Chair>()('Doors.Chair', { tier: 'seat' }) {
  static make(): Chair {
    return new Chair();
  }
}

class Absent extends Service<Absent>()('Doors.Absent', { tier: 'app' }) {}

const manifest = Layer.mergeAll(
  Layer.of(Toggles, new Toggles()),
  Clock,
  Lobby,
  Visit,
  Account,
  Chair,
  Layer.when(Toggles, (toggles) => toggles.on, Day),
  Layer.when(Visitor.present('user'), Card),
);

type Here = GroundOf<typeof manifest>;

const door = {
  use: <K>(key: K & UseDoorOn<K, Here>) => key,
  find: <K>(key: K & FindDoorOn<K, Here>) => key,
  build: <K>(key: K & BuildDoorOn<K, Here>) => key,
};

describe('use()', () => {
  it('opens on a key the manifest always provides in a tier open wherever anything is, and on what every world hands', () => {
    expect([door.use(Clock), door.use(Lobby), door.use(Platform), door.use(Router)]).toHaveLength(4);
  });

  it('refuses a key under a condition, one of a rung that may be closed, one of a kind, and one not provided', () => {
    // @ts-expect-error provided only while the toggle is on
    door.use(Day);
    // @ts-expect-error the visitor's rung may be closed
    door.use(Visit);
    // @ts-expect-error a guest has no account
    door.use(Account);
    // @ts-expect-error a seat's source always answers, but the seat stands under a room that may be closed
    door.use(Chair);
    // @ts-expect-error nothing provides it
    door.use(Absent);
    expect(door.use).toBeTypeOf('function');
  });
});

describe('find()', () => {
  it('opens on a key the manifest provides at all, and refuses one it never provides', () => {
    expect([door.find(Day), door.find(Account), door.find(Visit), door.find(Card)]).toHaveLength(4);
    // @ts-expect-error nothing provides it
    door.find(Absent);
  });
});

describe('Screen.mount and Process.start', () => {
  it('open for a recipe that names no tier on what stands wherever anything is', () => {
    class Section {
      static *make() {
        yield* Clock;
        yield* Lobby;
        yield* Platform;
        yield* Scope;
        return 'section';
      }
    }
    expect(door.build(Section)).toBe(Section);
  });

  it('open for a section of its own tier on what that tier holds — a signed-in one’s account and card', () => {
    class Cashier {
      static readonly tier = 'user';
      static *make() {
        yield* Account;
        yield* Card;
        yield* Visit;
        yield* Clock;
        return 'cashier';
      }
    }
    expect(door.build(Cashier)).toBe(Cashier);
  });

  it('refuse a section asking what its tier cannot reach or what the manifest gives only under a condition', () => {
    class Greeter {
      static *make() {
        yield* Visit;
        return 'greeter';
      }
    }
    class Wallet {
      static readonly tier = 'visitor';
      static *make() {
        yield* Card;
        return 'wallet';
      }
    }
    class Calendar {
      static *make() {
        yield* Day;
        return 'calendar';
      }
    }
    // @ts-expect-error a section with no tier stands in the hall, and the visitor's rung may be closed there
    door.build(Greeter);
    // @ts-expect-error the card is provided only for a signed-in visitor, and this section stands for a guest too
    door.build(Wallet);
    // @ts-expect-error the day is the toggle's alone
    door.build(Calendar);
  });
});
