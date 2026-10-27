import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { doorFixture, DoorFixture } from '../doorFixture.js';

layer(doorFixture(), { excludeTestServices: true })('dev surface door', (it) => {
  it.effect(
    'the window asks for the dev surface with an empty body and no project, and a server cut from no checkout refuses by its code',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const asked = yield* world.op('start_dev_surface', {});
        expect(asked.status).toBe(409);
        expect(asked.body).toMatchObject({ code: 'dev-surface-no-checkout' });
      }),
  );
});
