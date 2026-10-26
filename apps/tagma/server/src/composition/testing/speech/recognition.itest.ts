import { layer } from '@runlith/effect-test';
import { SpeechFixture, speechFixture } from './world.js';
import { expect } from 'bun:test';
import { SpeechEvent } from '@runlith/speech/wire/events';
import { event, ready, word } from '@runlith/speech/testing/world';
import { count } from 'drizzle-orm';
import { type Cause, Clock, Deferred, Effect, Fiber, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import type { Settings } from '../../../settings/contract/service/values.js';
import type { HearAsk } from '../../../speech/contract/service/listenings.js';
import { listening, transcriptLine } from '../../../speech/store/tables.js';
import { codeOf, fallbacks, sentFinish, silence, until, voice, type World } from './world.js';
const stored = Effect.flatMap(SpeechFixture, (fixture: SpeechFixture['Service']) =>
  Effect.gen(function* () {
    const { db } = yield* MachineStore;
    return yield* (yield* MachineUnits).read((unit) =>
      Effect.all([
        unit.run(db.select({ rows: count() }).from(listening).all()),
        unit.run(db.select({ rows: count() }).from(transcriptLine).all()),
      ]),
    );
  }),
);
layer(speechFixture({}), { excludeTestServices: true })('speech', (it) => {
  it.effect('recognition without a listening hears and keeps nothing', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const world = yield* fixture.stand.opened;
        const kept = yield* stored;
        const heard: string[] = [];
        const ask: HearAsk = { id: 'hear-1', tracks: [{ source: 'mic' }] };
        const hearing = yield* Effect.forkChild(
          Stream.runForEach(world.listenings.recognize(ask), (item) =>
            Effect.sync(() => {
              if (item.kind === 'utterance') heard.push(item.text);
            }),
          ),
        );
        yield* world.play(0, 3);
        const link = yield* world.links;
        yield* link.receive(ready);
        yield* link.receive(event(SpeechEvent.final('t1', [word('ephemeral', 0, 800)])));
        yield* until(() => heard.includes('ephemeral'), 'recognition to hear the phrase');
        yield* Fiber.interrupt(hearing);
        expect(yield* stored).toEqual(kept);
        yield* world.close(false);
      }),
    ),
  );
  it.effect('finishing a recognition delivers the confirmed tail before its stream ends, and an unknown id refuses', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const world = yield* fixture.stand.opened;
        const heard: string[] = [];
        const hearing = yield* Effect.forkChild(
          Stream.runForEach(world.listenings.recognize({ id: 'tail-1', tracks: [{ source: 'mic' }] }), (item) =>
            Effect.sync(() => {
              if (item.kind === 'utterance') heard.push(item.text);
            }),
          ),
        );
        yield* world.play(0, 3);
        const link = yield* world.links;
        yield* link.receive(ready);
        yield* link.receive(event(SpeechEvent.final('t1', [word('open', 0, 800)])));
        yield* until(() => heard.includes('open'), 'recognition to hear the open phrase');
        yield* world.listenings.finishRecognition('tail-1');
        yield* until(sentFinish(link), 'the track to ask for the tail');
        yield* link.receive(event(SpeechEvent.final('t2', [word('tail', 800, 1600)])));
        yield* link.receive(event(SpeechEvent.finished));
        yield* Fiber.join(hearing);
        expect(heard).toContain('tail');
        expect(codeOf(yield* Effect.flip(world.listenings.finishRecognition('tail-1')))).toBe('unknown-recognition');
        yield* world.close(false);
      }),
    ),
  );
  const frame = (seq: number, pcm: Int16Array): Uint8Array => {
    const bytes = new Uint8Array(4 + pcm.byteLength);
    new DataView(bytes.buffer).setUint32(0, seq, true);
    bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 4);
    return bytes;
  };
  const last = (count: number): Uint8Array => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, count, true);
    return bytes;
  };
  it.effect(
    'a sender that connects before its recognition opens waits for it, its frames are heard, a second sender refuses, and finish ends the sender at its last frame',
    () =>
      Effect.flatMap(SpeechFixture, (fixture) =>
        Effect.gen(function* () {
          const world = yield* fixture.stand.opened;
          const heard: string[] = [];
          const frames = yield* Queue.unbounded<Uint8Array, Cause.Done>();
          const sending = yield* Effect.forkChild(world.listenings.send('phone-1', 'mic', Stream.fromQueue(frames)), {
            startImmediately: true,
          });
          const hearing = yield* Effect.forkChild(
            Stream.runForEach(
              world.listenings.recognize({ id: 'phone-1', purpose: 'dictation', tracks: [{ source: 'mic', at: 'caller' }] }),
              (item) =>
                Effect.sync(() => {
                  if (item.kind === 'utterance') heard.push(item.text);
                  if (item.kind === 'state') heard.push(`state:${item.state}`);
                }),
            ),
          );
          yield* until(() => heard.includes('state:live'), 'the recognition to tell it is open');
          expect(codeOf(yield* Effect.flip(world.listenings.send('phone-1', 'mic', Stream.empty)))).toBe('sender-refused');
          yield* Queue.offerAll(frames, [frame(0, silence), frame(1, voice), frame(2, voice)]);
          const link = yield* world.links;
          yield* link.receive(ready);
          yield* link.receive(event(SpeechEvent.final('t1', [word('remote', 0, 800)])));
          yield* until(() => heard.includes('remote'), 'the sent phrase');
          yield* world.listenings.finishRecognition('phone-1');
          yield* Effect.sleep(20);
          expect(sentFinish(link)()).toBe(false);
          yield* Queue.offer(frames, last(3));
          expect(yield* Fiber.join(sending)).toBe('finished');
          yield* until(sentFinish(link), 'the track to ask for the tail');
          yield* link.receive(event(SpeechEvent.finished));
          yield* Fiber.join(hearing);
          expect(world.devices.captures.length).toBe(0);
          yield* world.close(false);
        }),
      ),
  );
  it.effect(
    'a caller track tells skipped frames as a transport gap, and frames that stop before finish lose the track with an open one',
    () =>
      Effect.flatMap(SpeechFixture, (fixture) =>
        Effect.gen(function* () {
          const world = yield* fixture.stand.opened;
          const gaps: Array<readonly [number, number | null]> = [];
          let live = false;
          const hearing = yield* Effect.forkChild(
            Stream.runForEach(world.listenings.recognize({ id: 'phone-2', tracks: [{ source: 'mic', at: 'caller' }] }), (item) =>
              Effect.sync(() => {
                if (item.kind === 'state' && item.state === 'live') live = true;
                if (item.kind === 'gap' && item.cause === 'transport') gaps.push([item.from, item.to]);
              }),
            ),
          );
          yield* until(() => live, 'the caller recognition to open');
          expect(
            yield* world.listenings.send('phone-2', 'mic', Stream.fromIterable([frame(0, silence), frame(1, voice), frame(4, voice)])),
          ).toBe('lost');
          yield* until(() => gaps.length === 2, 'the skipped frames and the open transport gap');
          expect(gaps.map(([from, to]) => (to === null ? null : Math.round(to - from)))).toEqual([40, null]);
          yield* Fiber.interrupt(hearing);
          expect(
            codeOf(
              yield* Effect.flip(
                Stream.runDrain(world.listenings.recognize({ id: 'phone-3', tracks: [{ source: 'system', at: 'caller' }] })),
              ),
            ),
          ).toBe('track-invalid');
          gaps.length = 0;
          const again = yield* Effect.forkChild(
            Stream.runForEach(world.listenings.recognize({ id: 'phone-4', tracks: [{ source: 'mic', at: 'caller' }] }), (item) =>
              Effect.sync(() => {
                if (item.kind === 'gap' && item.cause === 'transport') gaps.push([item.from, item.to]);
              }),
            ),
          );
          const held = yield* Queue.unbounded<Uint8Array, Cause.Done>();
          yield* Queue.offer(held, frame(0, voice));
          const received = yield* Deferred.make<void>();
          const cancelled = yield* Effect.forkChild(
            world.listenings.send('phone-4', 'mic', Stream.fromQueue(held).pipe(Stream.tap(() => Deferred.succeed(received, undefined)))),
          );
          yield* Deferred.await(received).pipe(Effect.timeout('5 seconds'));
          yield* Fiber.interrupt(cancelled);
          yield* until(() => gaps.some(([, to]) => to === null), 'a cancelled sender to lose its track');
          yield* Fiber.interrupt(again);
          yield* world.close(false);
        }),
      ),
  );
  it.effect('unsubscribing from a recognition stops it without asking for the tail', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const world = yield* fixture.stand.opened;
        const hearing = yield* Effect.forkChild(Stream.runDrain(world.listenings.recognize({ id: 'cut-1', tracks: [{ source: 'mic' }] })));
        yield* world.play(0, 3);
        const link = yield* world.links;
        yield* link.receive(ready);
        yield* Fiber.interrupt(hearing);
        expect(sentFinish(link)()).toBe(false);
        expect(codeOf(yield* Effect.flip(world.listenings.finishRecognition('cut-1')))).toBe('unknown-recognition');
        yield* world.close(false);
      }),
    ),
  );
  const settingsWith = (picks: {
    readonly dictation?: {
      readonly provider: string;
    };
    readonly general?: {
      readonly provider: string;
    };
  }): Settings['Service'] => ({
    ...fallbacks,
    value: (key) =>
      Effect.succeed(
        key.id === 'speech.dictation.recognizer' && picks.dictation !== undefined
          ? (picks.dictation as typeof key.fallback)
          : key.id === 'speech.recognizer' && picks.general !== undefined
            ? (picks.general as typeof key.fallback)
            : key.fallback,
      ),
  });
  const refusalOf = (world: World, ask: HearAsk) => Effect.map(Effect.flip(Stream.runDrain(world.listenings.recognize(ask))), codeOf);
  it.effect('only a dictation recognition follows the dictation recognizer setting', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const world = yield* fixture.stand.openedWith({ settings: settingsWith({ dictation: { provider: 'absent' } }) });
        expect(yield* refusalOf(world, { id: 'pick-1', purpose: 'dictation', tracks: [{ source: 'mic' }] })).toBe('no-model');
        const bare = yield* Effect.forkChild(Stream.runDrain(world.listenings.recognize({ id: 'pick-2', tracks: [{ source: 'mic' }] })));
        yield* until(() => world.devices.captures.length === 1, 'a bare recognition to capture');
        yield* Fiber.interrupt(bare);
        yield* world.close(false);
      }),
    ),
  );
  it.effect('an empty dictation recognizer setting falls back to the general choice', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const world = yield* fixture.stand.openedWith({ settings: settingsWith({ general: { provider: 'absent' } }) });
        expect(yield* refusalOf(world, { id: 'pick-3', purpose: 'dictation', tracks: [{ source: 'mic' }] })).toBe('no-model');
        yield* world.close(false);
      }),
    ),
  );
  it.effect('speech status reports the recognizer a dictation ask would select', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const ready = yield* (yield* fixture.stand.opened).status;
        expect(ready.dictation).toMatchObject({ kind: 'ready', provider: 'scripted', model: 'live' });
        const blocked = yield* (yield* fixture.stand.openedWith({ settings: settingsWith({ dictation: { provider: 'absent' } }) })).status;
        expect(blocked.dictation.kind).toBe('blocked');
      }),
    ),
  );
  it.effect('two subscriptions with one recognition id admit exactly one', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const world = yield* fixture.stand.opened;
        const ask: HearAsk = { id: 'twin-1', tracks: [{ source: 'mic' }] };
        const first = yield* Effect.forkChild(Effect.result(Stream.runDrain(world.listenings.recognize(ask))));
        const second = yield* Effect.forkChild(Effect.result(Stream.runDrain(world.listenings.recognize(ask))));
        const refused = yield* Effect.raceFirst(Fiber.join(first), Fiber.join(second));
        expect(refused._tag === 'Failure' ? codeOf(refused.failure) : refused._tag).toBe('track-invalid');
        yield* until(() => world.devices.captures.length === 1, 'the admitted recognition to capture');
        yield* Effect.sleep(20);
        expect(world.devices.captures.length).toBe(1);
        yield* Fiber.interrupt(first);
        yield* Fiber.interrupt(second);
        yield* world.close(false);
      }),
    ),
  );
  it.effect('a recognition whose recognizer never confirms the tail is cut after finish', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const world = yield* fixture.stand.opened;
        const hearing = yield* Effect.forkChild(
          Stream.runDrain(world.listenings.recognize({ id: 'bound-1', tracks: [{ source: 'mic' }] })),
        );
        yield* world.play(0, 3);
        const link = yield* world.links;
        yield* link.receive(ready);
        const clock = yield* TestClock.make();
        yield* Effect.provideService(world.listenings.finishRecognition('bound-1'), Clock.Clock, clock);
        yield* until(sentFinish(link), 'the track to ask for the tail');
        yield* clock.adjust('1 minute');
        yield* Fiber.join(hearing);
        expect(codeOf(yield* Effect.flip(world.listenings.finishRecognition('bound-1')))).toBe('unknown-recognition');
        yield* world.close(false);
      }),
    ),
  );
});
