import { describe, expect, it } from 'vitest';

import { App, MountedApp } from './App.js';
import { Layer } from './Layer.js';
import { Rung } from './Rung.js';
import { Visitor } from './testing.js';

function inlineRoot(build: () => void): () => void {
  build();
  return () => undefined;
}

type Named = { readonly id: string };

const Hall = Rung.define<Named>()('hall', { keyOf: (hall) => hall.id, always: true });
const Room = Rung.define<Named>()('room', { keyOf: (room) => room.id, under: Visitor });
const Seat = Rung.define<Named>()('seat', { keyOf: (seat) => seat.id, under: Room, always: true });

describe('the deepest tier open wherever anything is', () => {
  it('is the last rung of an unbroken chain of rungs open always: one open always under a room that may close is not', async () => {
    const app = new MountedApp(
      App.define(
        Layer.mergeAll(
          Hall.of(() => ({ id: 'main' })),
          Visitor.of(() => Visitor.guest()),
          Room.of(() => undefined),
          Seat.of(() => ({ id: '1' })),
        ),
        { ladder: [Hall, Visitor, Room, Seat] },
      ),
      Layer.mergeAll(),
      { effectRoot: inlineRoot, start: 'open' },
    );
    expect(app.alwaysOpen()).toBe('hall');
    await app.close();
  });
});
