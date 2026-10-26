import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { watchTickets } from './tickets.js';

it.effect('an ungranted watch polls and releasing its ticket admits the next watcher', () =>
  Effect.gen(function* () {
    const tickets = watchTickets(1);
    const first = yield* tickets.grant();
    expect(typeof first).toBe('function');
    expect(tickets.standing()).toEqual({ budget: 1, active: 1 });
    expect(yield* tickets.grant()).toBeNull();
    first?.();
    const second = yield* tickets.grant();
    expect(typeof second).toBe('function');
    second?.();
    expect(tickets.standing()).toEqual({ budget: 1, active: 0 });
    expect(yield* watchTickets(0).grant()).toBeNull();
  }),
);
