import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import type { Outbound } from '@runlith/acp/events';
import { ByteOffset } from '@runlith/executions/protocol/record';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import { HarnessLanes } from '../sessions/lanes.js';
import { keyboardRecord, keyboardRig, type KeyboardRig } from '../testing/keyboard.js';
import { ProtocolWriter, type Landing } from './writing.js';

const prompt: Outbound = {
  receipt: { _tag: 'Request', id: 'prompt-1' },
  envelope: { _tag: 'Request', id: 'prompt-1', method: 'session/prompt', params: { sessionId: 's', prompt: [] } },
};

const configure: Outbound = {
  receipt: { _tag: 'Request', id: 'configuration' },
  envelope: {
    _tag: 'Request',
    id: 'configuration',
    method: 'session/set_config_option',
    params: { sessionId: 's', configId: 'model', value: 'chosen' },
  },
};

const steer: Outbound = {
  receipt: { _tag: 'Request', id: 'steer-1' },
  envelope: {
    _tag: 'Request',
    id: 'steer-1',
    method: '_tagma/steer',
    params: { sessionId: 's', input: 'words', prompt: [{ type: 'image', data: 'A'.repeat(40_000), mimeType: 'image/png' }] },
  },
};

const writerOf = Effect.fnUntraced(function* (face: KeyboardRig, writing: TerminalWriting['Service']) {
  const record = keyboardRecord();
  const lanes = new HarnessLanes(face.grants, writing);
  yield* lanes.open('session', record.projectId, record.execution, record.holder);
  return yield* ProtocolWriter.make(writing, lanes, 'session');
});

const landed = Effect.fnUntraced(function* (writer: ProtocolWriter, count: number) {
  const landings: Landing[] = [];
  const done = yield* Deferred.make<void>();
  yield* Effect.raceFirst(
    Deferred.await(done),
    writer.drive(
      Effect.sync(() => {
        for (let landing = writer.take(); landing !== undefined; landing = writer.take()) landings.push(landing);
        if (landings.length === count) Deferred.doneUnsafe(done, Effect.void);
      }),
    ),
  );
  return landings;
});

const decoded = (face: KeyboardRig): readonly string[] => face.accepted.map((input) => new TextDecoder().decode(input.bytes));

it.effect('a cancel is written ahead of every unwritten frame, drops the queued frames of its turn and keeps the others after it', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [] });
    const writer = yield* writerOf(face, face.writing);
    yield* writer.enqueue([prompt, configure]);
    const cancel = writer.cancel({ sessionId: 's' }, ['turn-1'], 'reader');
    const landings = yield* landed(writer, 3);
    expect(decoded(face).map((line) => JSON.parse(line).method)).toEqual(['session/cancel', 'session/set_config_option']);
    expect(landings).toEqual([
      { _tag: 'Cancel', cancel, written: { _tag: 'Admitted' } },
      { _tag: 'Frame', receipt: prompt.receipt, written: { _tag: 'Unwritten', reason: expect.any(String), poisoned: false } },
      { _tag: 'Frame', receipt: configure.receipt, written: { _tag: 'Admitted' } },
    ]);
  }),
);

it.effect('a turn frame issued before a cancel and queued after it is not written', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [] });
    const writer = yield* writerOf(face, face.writing);
    const issued = writer.generation();
    const cancel = writer.cancel({ sessionId: 's' }, ['turn-1'], 'reader');
    yield* writer.enqueue([steer], issued);
    const landings = yield* landed(writer, 2);
    expect(decoded(face).map((line) => JSON.parse(line).method)).toEqual(['session/cancel']);
    expect(landings).toEqual([
      { _tag: 'Cancel', cancel, written: { _tag: 'Admitted' } },
      { _tag: 'Frame', receipt: steer.receipt, written: { _tag: 'Unwritten', reason: expect.any(String), poisoned: false } },
    ]);
  }),
);

it.live('a cancel cuts a frame stuck mid-transfer, closes its line unreadable and is written right after it', () =>
  Effect.gen(function* () {
    const face = keyboardRig({ frames: [] });
    const pressed = yield* Deferred.make<void>();
    let blocked = false;
    const writing = {
      ...face.writing,
      input: (...input: Parameters<TerminalWriting['Service']['input']>) => {
        if (blocked) {
          Deferred.doneUnsafe(pressed, Effect.void);
          return Effect.succeed({
            _tag: 'InputBackpressure' as const,
            frontier: { acceptedThrough: ByteOffset.make('16384'), pendingBytes: 16384 },
            pendingBytes: 16384,
            limit: 16384,
          });
        }
        blocked = input[2].act._tag === 'Write' && new TextDecoder().decode(input[2].act.bytes).includes('_tagma/steer');
        return face.writing.input(...input);
      },
    } as TerminalWriting['Service'];
    const writer = yield* writerOf(face, writing);
    yield* writer.enqueue([steer]);
    const landings = yield* Effect.forkChild(landed(writer, 2));
    yield* Deferred.await(pressed);
    const cancel = writer.cancel({ sessionId: 's' }, ['turn-1'], 'reader');
    blocked = false;
    const reported = yield* Fiber.join(landings);
    const lines = decoded(face);
    expect(lines.map((line) => line.length)).toEqual([16_384, 1, lines[2]!.length]);
    expect(lines[1]).toBe('\n');
    expect(JSON.parse(lines[2]!).method).toBe('session/cancel');
    expect(reported).toEqual([
      { _tag: 'Cancel', cancel, written: { _tag: 'Admitted' } },
      { _tag: 'Frame', receipt: steer.receipt, written: { _tag: 'Unwritten', reason: expect.any(String), poisoned: false } },
    ]);
  }),
);
