import { describe, expect, it } from 'vitest';

import { Graph } from './Graph.js';
import { Service } from './key.js';
import { Layer } from './Layer.js';
import { Rung, type AnyRung } from './Rung.js';
import { Scope } from './Scope.js';
import { Visitor } from './testing.js';

function inlineRoot(build: () => void): () => void {
  build();
  return () => undefined;
}

const Room = Rung.define<{ readonly id: string }>()('room', { keyOf: (room) => room.id, under: Visitor });

class Brand extends Service<Brand>()('Brand', { tier: 'app' }) {
  constructor(readonly name: string) {
    super();
  }
}

interface Receiver {
  readonly label: string;
}

class Bus extends Service<Bus>()('Bus', { tier: 'app' }) {
  static make(): Bus {
    return new Bus();
  }

  static receiver = Layer.member(
    () => Bus,
    (bus: Bus, receiver: Receiver) => bus.add(receiver),
  );

  readonly joined: string[] = [];
  readonly left: string[] = [];

  add(receiver: Receiver): () => void {
    this.joined.push(receiver.label);
    return () => void this.left.push(receiver.label);
  }
}

class Plain extends Service<Receiver>()('Plain', { tier: 'app' }) {}

class Branded extends Service<Receiver>()('Branded', { tier: 'app' }) {}

class Guest extends Service<Receiver>()('Guest', { tier: 'room' }) {}

function open(layer: Layer<never, never> | ReturnType<typeof Layer.mergeAll>, ladder: readonly AnyRung[] = []) {
  const graph = new Graph(layer, { effectRoot: inlineRoot, ladder });
  const app = Scope.make();
  return { graph, app, ready: graph.open(app) };
}

describe('Layer.member', () => {
  it('builds the member like any service and hands the owner the same instance', async () => {
    const { graph, app, ready } = open(Layer.mergeAll(Bus, Bus.receiver(Layer.provide(Plain, () => ({ label: 'plain' })))));
    await ready;

    const bus = graph.resolve(Bus, app);
    expect(bus.joined).toEqual(['plain']);
    expect(graph.resolve(Plain, app)).toBe(graph.resolve(Plain, app));
    await app.close();
  });

  it('takes a recipe that reads the graph', async () => {
    const { graph, app, ready } = open(
      Layer.mergeAll(
        Bus,
        Layer.of(Brand, new Brand('acme')),
        Bus.receiver(
          Layer.provide(Branded, function* () {
            return { label: (yield* Brand).name };
          }),
        ),
      ),
    );
    await ready;

    expect(graph.resolve(Bus, app).joined).toEqual(['acme']);
    await app.close();
  });

  it('leaves the owner when the scope that built it closes', async () => {
    const { graph, app, ready } = open(Layer.mergeAll(Bus, Bus.receiver(Layer.provide(Plain, () => ({ label: 'plain' })))));
    await ready;
    const bus = graph.resolve(Bus, app);

    await app.close();

    expect(bus.left).toEqual(['plain']);
  });

  it('holds a member of a tier below its owner only while that tier stands, and the owner outlives it', async () => {
    const { graph, app, ready } = open(
      Layer.mergeAll(
        Bus,
        Bus.receiver(
          Layer.provide(Guest, function* () {
            return { label: (yield* Room.Current).id };
          }),
        ),
      ),
      [Visitor, Room],
    );
    await ready;
    const bus = graph.resolve(Bus, app);
    const visitor = graph.openRung(app, Visitor, Visitor.guest());
    await visitor.ready;

    const room = graph.openRung(visitor.scope, Room, { id: 'lounge' });
    await room.ready;
    expect(bus.joined).toEqual(['lounge']);

    await room.scope.close();
    expect(bus.left).toEqual(['lounge']);
    expect(graph.resolve(Bus, app)).toBe(bus);
    await app.close();
  });
});
