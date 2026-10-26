import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { LEASE_RHYTHM } from '../../threads/contract/wire/rhythm.js';
import { keyboardSession } from '../testing/driver.js';
import { keyboardFrame, keyboardRig } from '../testing/keyboard.js';

it.effect('recovery preserves a foreign fresh session lease and seats its active run when that lease expires', () =>
  Effect.gen(function* () {
    const world = yield* keyboardSession({ name: 'cursor', keyboard: keyboardRig({ frames: [keyboardFrame(['  → Add a follow-up'])] }) });
    yield* TestClock.adjust(1);
    yield* world.reports.reported(world.id, {
      session: world.session,
      receipt: 'prompt',
      event: { hook_event_name: 'beforeSubmitPrompt', session_id: 'root', generation_id: 'gen-1' },
    });
    const run = yield* world.world.ledger.activeRun(world.id);
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    yield* world.store.change(world.id, (facet) =>
      Effect.succeed({ facet: { ...facet, session: { ...facet.session!, ownerId: 'other-server', heartbeatAt: at } }, value: undefined }),
    );
    yield* world.driver.lease.recover();
    expect((yield* world.store.read(world.id))?.session?.ownerId).toBe('other-server');
    yield* TestClock.adjust(LEASE_RHYTHM.takeoverAfterMs + 1);
    expect((yield* world.store.read(world.id))?.session?.ownerId).toBe('keyboard-owner');
    yield* world.driver.ready(world.id);
    expect((yield* world.world.ledger.activeRun(world.id))?.id).toBe(run?.id);
    expect((yield* world.store.read(world.id))?.session?.state).toBe('running');
  }),
);
