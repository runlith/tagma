import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { grok } from '@runlith/adapter-xai/harness';
import { keyboardSession } from '../testing/driver.js';
import { keyboardFrame, keyboardRig } from '../testing/keyboard.js';

type Session = Effect.Success<ReturnType<typeof keyboardSession>>;
const working = Effect.fnUntraced(function* (world: Session, name = 'UserPromptSubmit') {
  yield* TestClock.adjust(1);
  yield* world.reports.reported(world.id, {
    session: world.session,
    receipt: crypto.randomUUID(),
    event: { hook_event_name: name, session_id: 'root', prompt_id: 'p1', generation_id: 'gen-1' },
    prompt: 'work',
  });
  const run = yield* world.world.ledger.activeRun(world.id);
  if (run == null) return yield* Effect.die('The prompt opened no run.');
  return run;
});

it.effect('a persisted Grok draft interruption finishes its recorded sequence after the composer has emptied', () =>
  Effect.gen(function* () {
    const keyboard = keyboardRig({ frames: [keyboardFrame(['│ ❯ │', '╰────'])] });
    const world = yield* keyboardSession({ name: 'grok', keyboard, harnesses: [grok] });
    const run = yield* working(world);
    yield* world.store.change(world.id, (facet) =>
      Effect.succeed({
        facet: { ...facet, interrupting: { run: run.id, operation: `interrupt:${run.id}`, drafted: true } },
        value: undefined,
      }),
    );
    yield* world.runs.transport.interrupt(run.id, 'reader');
    expect(keyboard.accepted.map((input) => [...input.bytes])).toEqual([[3], [3], [26]]);
    expect((yield* world.store.read(world.id))?.interrupting).toBeUndefined();
    expect((yield* world.store.read(world.id))?.session?.state).toBe('running');
    expect((yield* world.world.ledger.runById(run.id))?.status).toBe('aborted');
  }),
);

it.effect('Cursor interrupts a draft once and an unconfirmed repeated stop cannot arm process exit', () =>
  Effect.gen(function* () {
    const keyboard = keyboardRig({ frames: [keyboardFrame(['  → my own unsent words'])] });
    const world = yield* keyboardSession({ name: 'cursor', keyboard });
    const run = yield* working(world, 'beforeSubmitPrompt');
    expect(yield* world.runs.transport.interrupt(run.id, 'reader')).toBe('interrupted');
    expect(yield* world.runs.transport.interrupt(run.id, 'reader')).toBe('interrupted');
    expect(keyboard.accepted.map((input) => [...input.bytes])).toEqual([[3]]);
    const facet = yield* world.store.read(world.id);
    expect(facet?.interrupted?.turn.run).toBe(run.id);
    expect(facet?.armed?.confirmedAt).toBeUndefined();
    expect(facet?.session?.state).toBe('running');
    expect((yield* world.world.ledger.runById(run.id))?.status).toBe('aborted');
  }),
);
