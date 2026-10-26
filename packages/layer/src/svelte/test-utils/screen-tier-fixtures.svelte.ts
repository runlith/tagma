import { App as Core } from '../../App.js';
import { Service, type Provided } from '../../key.js';
import { Layer } from '../../Layer.js';
import { Rung } from '../../Rung.js';
import { Scope } from '../../Scope.js';
import { Visitor, type VisitorInput } from '../../testing.js';
import { Screen } from '../screen.svelte.js';

type RoomInput = { readonly id: string };

export const Room = Rung.define<RoomInput>()('room', { keyOf: (room) => room.id, under: Visitor });

export class Doorman extends Service<Doorman>()('Doorman', { tier: 'hall' }) {
  static make(): Doorman {
    return new Doorman();
  }
}

export const Hall = Rung.define<RoomInput, never, Provided<typeof Doorman>>()('hall', {
  keyOf: (hall) => hall.id,
  always: true,
  own: () => Layer.mergeAll(Doorman),
});

export const at = $state<{ visitor: VisitorInput | undefined; room: RoomInput | undefined }>({
  visitor: Visitor.user('7'),
  room: { id: 'a' },
});

export const page = $state<{ open: boolean }>({ open: true });

export class Table extends Service<Table>()('Table', { tier: 'room' }) {
  static make(): Table {
    return new Table();
  }
}

export class Ledger extends Service<Ledger>()('Ledger', { tier: 'app' }) {
  static make(): Ledger {
    return new Ledger('manifest');
  }
  constructor(readonly name: string) {
    super();
  }
}

export const definition = Core.define(
  Layer.mergeAll(
    Table,
    Ledger,
    Visitor.of(() => at.visitor),
    Room.of(() => at.room),
    Hall.of(() => ({ id: 'main' })),
  ),
  { ladder: [Hall, Visitor, Room] },
);

export class LobbyScreen extends Screen<LobbyScreen>()('LobbyScreen') {
  static override *make() {
    return new LobbyScreen(yield* Doorman, yield* Scope);
  }
  constructor(
    readonly doorman: Doorman,
    readonly scope: Scope,
  ) {
    super();
  }
}

export class VisitorScreen extends Screen<VisitorScreen>()('VisitorScreen', { tier: 'visitor' }) {
  static override *make() {
    return new VisitorScreen(yield* Scope);
  }
  constructor(readonly scope: Scope) {
    super();
  }
}

export class RoomScreen extends Screen<RoomScreen>()('RoomScreen', { tier: 'room' }) {
  static override *make() {
    return new RoomScreen(yield* Scope);
  }
  constructor(readonly scope: Scope) {
    super();
  }
}

export class GreedyScreen extends Screen<GreedyScreen>()('GreedyScreen', { tier: 'visitor' }) {
  static override *make() {
    return new GreedyScreen(yield* Table);
  }
  constructor(readonly table: Table) {
    super();
  }
}

export class GuestScreen extends Screen<GuestScreen>()('GuestScreen', { tier: 'guest' }) {
  static override *make() {
    return new GuestScreen(yield* Scope);
  }
  constructor(readonly scope: Scope) {
    super();
  }
}

export class LedgerScreen extends Screen<LedgerScreen>()('LedgerScreen', { tier: 'visitor' }) {
  static override *make() {
    return new LedgerScreen(yield* Ledger);
  }
  constructor(readonly ledger: Ledger) {
    super();
  }
}

export class ExitScreen extends Screen<ExitScreen>()('ExitScreen', { tier: 'visitor' }) {
  static override *make() {
    return new ExitScreen(yield* Scope);
  }
  private count = $state(0);
  readonly landed: string[] = [];
  constructor(readonly scope: Scope) {
    super();
  }
  commit(when: Promise<void>): void {
    void this.scope
      .await(when)
      .then(() => this.landed.push('landed'))
      .catch(() => undefined);
  }
  bump(): number {
    this.count += 1;
    return this.count;
  }
}
