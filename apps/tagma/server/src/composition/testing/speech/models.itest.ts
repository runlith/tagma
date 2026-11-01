import { layer } from '@runlith/effect-test';
import { SpeechFixture, speechFixture } from './world.js';
import { expect } from 'bun:test';
import { type Cause, Effect, Fiber, Queue, Stream } from 'effect';
import type { LocalModels } from '../../../speech/contract/service/models.js';
import type { InstallEvent } from '../../../speech/contract/wire/feeds.js';
layer(speechFixture(), { excludeTestServices: true })('speech', (it) => {
  it.effect('an install tells its progress to a subscriber from the start to the whole model', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const chunks = yield* Queue.unbounded<number, Cause.Done>();
        const local: LocalModels['Service'] = {
          list: Effect.succeed([{ id: 'tiny', label: 'Tiny', size: 100, installed: false, partial: 0 }]),
          install: (model) => Stream.map(Stream.fromQueue(chunks), (received) => ({ model, received, size: 100 })),
          remove: () => Effect.void,
        };
        const world = yield* fixture.stand.openedWith({ local });
        const shown = (one: InstallEvent) =>
          one.kind === 'snapshot'
            ? ['snapshot', one.installs.map((install) => [install.model, install.received])]
            : one.kind === 'removed'
              ? ['removed', one.model]
              : [one.model, one.received, one.total, one.failure];
        const opening = Stream.runCollect(Stream.take(world.models.progress, 1));
        const told = yield* Effect.forkChild(Stream.runCollect(Stream.take(world.models.progress, 4)));
        yield* Effect.yieldNow;
        expect(yield* world.models.install('tiny')).toBe('installing');
        yield* Queue.offer(chunks, 40);
        yield* Effect.yieldNow;
        const midway = yield* opening;
        yield* Queue.end(chunks);
        expect((yield* Fiber.join(told)).map(shown)).toEqual([
          ['snapshot', []],
          ['tiny', 0, 100, null],
          ['tiny', 40, 100, null],
          ['tiny', 100, 100, null],
        ]);
        expect([...midway, ...(yield* opening)].map(shown)).toEqual([
          ['snapshot', [['tiny', 40]]],
          ['snapshot', []],
        ]);
        yield* world.close(false);
      }),
    ),
  );
  it.effect('two models install at once, and removing one cancels only its own install before its files go', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const removed: string[] = [];
        const local: LocalModels['Service'] = {
          list: Effect.succeed(['a', 'b'].map((id) => ({ id, label: id, size: 100, installed: false, partial: 0 }))),
          install: (model) => Stream.concat(Stream.make({ model, received: 10, size: 100 }), Stream.never),
          remove: (model) => Effect.sync(() => void removed.push(model)),
        };
        const world = yield* fixture.stand.openedWith({ local });
        expect(yield* world.models.install('a')).toBe('installing');
        expect(yield* world.models.install('b')).toBe('installing');
        const told = yield* Effect.forkChild(Stream.runCollect(Stream.takeUntil(world.models.progress, (one) => one.kind === 'removed')));
        yield* Effect.yieldNow;
        yield* world.models.remove('a');
        expect(removed).toEqual(['a']);
        expect(
          (yield* Fiber.join(told))
            .slice(-2)
            .map((one) =>
              one.kind === 'snapshot' ? [one.kind] : one.kind === 'removed' ? [one.kind, one.model] : [one.model, one.failure !== null],
            ),
        ).toEqual([
          ['a', true],
          ['removed', 'a'],
        ]);
        const standing = yield* world.models.list;
        expect(standing.map((one) => [one.id, one.received !== null && one.failure === null])).toEqual([
          ['a', false],
          ['b', true],
        ]);
        yield* world.close(false);
      }),
    ),
  );
  it.effect('stop_speaking silences a voice an open caller still holds and refuses its next words', () =>
    Effect.flatMap(SpeechFixture, (fixture) =>
      Effect.gen(function* () {
        const world = yield* fixture.stand.opened;
        const utterer = yield* world.speaking.open({});
        yield* utterer.say('hello');
        expect(yield* world.speaking.stop).toBe(1);
        const refused = yield* Effect.flip(utterer.say('again'));
        yield* utterer.played;
        expect([refused.code, world.devices.players.map((player) => player.released)]).toEqual(['speech-failed', [true]]);
        yield* world.close(false);
      }),
    ),
  );
});
