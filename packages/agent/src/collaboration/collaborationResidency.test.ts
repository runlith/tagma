import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ThreadMetadataRow } from '../thread/rows';
import { DeclaredCollaboration } from './CollaborationConfig';
import { SpawnSeats, spawnSeatsLayer } from './collaborationResidency';
const child = (id: string) => ({ id, parentThreadId: 'root' }) as ThreadMetadataRow;
const unused = () => Effect.die('Seat admission does not read the collaboration policy.');
const seatsOf = Effect.fnUntraced(function* (spawnSlots: number) {
  const configured = spawnSeatsLayer.pipe(
    Layer.provide(
      Layer.succeed(DeclaredCollaboration, {
        spawnSlots,
        models: () => modelCatalog([]),
        subAgentDepth: unused,
        delegation: unused,
        reconcileIntervalMs: 1_000,
      }),
    ),
  );
  return Context.get(yield* Layer.build(configured), SpawnSeats);
});
it.effect(
  'a spawned thread past the host slots is refused until a seat is released',
  Effect.fnUntraced(function* () {
    const seats = yield* seatsOf(1);
    yield* seats.admit(child('a'));
    expect((yield* Effect.flip(seats.admit(child('b'))))._tag).toBe('ThreadCallBroke');
    seats.unseat('a');
    yield* seats.admit(child('b'));
    expect(seats.resident()).toBe(1);
  }),
);
it.effect(
  'repeated admission takes one seat; only its bound runs can release it',
  Effect.fnUntraced(function* () {
    const seats = yield* seatsOf(1);
    yield* seats.admit(child('a'));
    yield* seats.admit(child('a'));
    expect(seats.resident()).toBe(1);
    seats.bind('a', 'run-1');
    yield* seats.admit(child('a'));
    seats.bind('a', 'run-2');
    seats.ended('run-1');
    expect(seats.resident()).toBe(1);
    seats.ended('run-2');
    expect(seats.resident()).toBe(0);
    yield* seats.admit(child('a'));
    seats.bind('a', 'run-3');
    yield* seats.admit(child('a'));
    seats.unseat('a');
    expect(seats.resident()).toBe(1);
    seats.ended('run-3');
    expect(seats.resident()).toBe(0);
  }),
);
