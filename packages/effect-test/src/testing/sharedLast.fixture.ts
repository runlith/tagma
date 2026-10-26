import { afterAll } from 'bun:test';
import { Effect } from 'effect';
import { it } from '../testing';

const released: string[] = [];
const holding = (name: string) =>
  Effect.andThen(
    Effect.acquireRelease(Effect.void, () =>
      Effect.sync(() => {
        released.push(name);
      }),
    ),
    Effect.never,
  );
it.effect('cleans a later file effect on timeout', () => holding('effect'), 20);
it.live('cleans a later file live effect on timeout', () => holding('live'), 20);
afterAll(() => console.log(JSON.stringify({ released })));
