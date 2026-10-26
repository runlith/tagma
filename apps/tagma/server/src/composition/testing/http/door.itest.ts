import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { makeDoorWorld } from '../doorFixture.js';

it.live('an unknown /api path answers a JSON 404 whose unblock names the route document', () =>
  Effect.gen(function* () {
    const world = yield* makeDoorWorld();
    const answer = yield* world.call('/api/no-such-route');
    expect(answer.status).toBe(404);
    expect(answer.body).toMatchObject({ code: 'not-found' });
    const unblock = (answer.body as { unblock?: readonly string[] }).unblock ?? [];
    expect(unblock.length).toBeGreaterThanOrEqual(1);
    expect(unblock.join(' ')).toContain('/api/openapi.json');
  }),
);
