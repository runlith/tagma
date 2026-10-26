import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import type { Clip } from '../protocol/adapter.ts';
import { batching } from '../testing/models.ts';
import { scriptedProvider } from '../testing/scriptedProvider.ts';
import { inWorld, type Listening, settle } from '../testing/world.ts';
import { SpeechEvent } from '../wire/events.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { Gap, TrackState, Utterance } from '../wire/heard.ts';
import { type ListeningSettings, listeningDefaults } from './settings.ts';

const whisper = batching('whisper');
const choice = { provider: 'local', model: whisper, turns: 'client', wants: {} } as const;

const play = (listening: Listening, values: ReadonlyArray<number>) =>
  Effect.forEach(values, (value) => Effect.andThen(listening.track.play(new Int16Array(320).fill(value)), settle), { discard: true });

const quiet = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index);
const loud = (count: number) => Array.from({ length: count }, (_, index) => 2_000 + index);

const said = (clip: Clip) =>
  Stream.fromIterable([
    SpeechEvent.final('0', [{ lane: 'source', text: `clip of ${clip.pcm.length}`, granularity: 'segment' }]),
    SpeechEvent.turnEnd('0'),
  ]);

const closed = (listening: Listening) => listening.heard.filter((item): item is Utterance => item._tag === 'Utterance' && item.closed);
const gaps = (listening: Listening) => listening.heard.filter((item): item is Gap => item._tag === 'Gap');

const fast: ListeningSettings = {
  ...listeningDefaults,
  segmenter: { start: 0.5, end: 0.35, minSpeechMs: 40, minSilenceMs: 100, preRollMs: 0, maxMs: 20_000 },
};

it.effect('a clip keeps its whole pre-roll under the default Segmenter settings', () =>
  Effect.gen(function* () {
    const clips: Array<Int16Array> = [];
    const local = scriptedProvider({
      id: 'local',
      recognition: [whisper],
      batch: (clip) => Stream.fromEffect(Effect.sync(() => clips.push(clip.pcm))).pipe(Stream.drain),
    });
    yield* inWorld([local], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice);
        yield* play(listening, [...quiet(1, 20), ...loud(30), ...quiet(1, 40)]);
        yield* listening.track.close;
        yield* settle;
      }),
    );
    expect(clips.map((pcm) => [pcm[0], pcm.length])).toEqual([[6, 14_400]]);
  }),
);

it.effect('two clips are timed from their own starts, and a retryable failure is retried after its backoff', () =>
  Effect.gen(function* () {
    let calls = 0;
    const local = scriptedProvider({
      id: 'local',
      recognition: [whisper],
      batch: (clip) => {
        calls += 1;
        return calls === 1 ? Stream.fail(SpeechFailure.rate('busy', 2_000)) : said(clip);
      },
    });
    const seen = yield* inWorld([local], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings: fast });
        yield* play(listening, [...quiet(1, 10), ...loud(10), ...quiet(1, 10)]);
        const before = calls;
        yield* TestClock.adjust(2_000);
        yield* settle;
        yield* play(listening, [...loud(5), ...quiet(1, 10)]);
        yield* listening.track.close;
        yield* settle;
        return { before, listening };
      }),
    );
    expect(seen.before).toBe(1);
    expect(closed(seen.listening).map((item) => [item.id.seq, item.text, item.span])).toEqual([
      [1, 'clip of 3200', { from: 200, to: 400 }],
      [2, 'clip of 1600', { from: 600, to: 700 }],
    ]);
    expect(gaps(seen.listening)).toEqual([]);
    expect(seen.listening.heard.at(-1)?._tag).toBe('Finished');
  }),
);

it.effect('the clip road reports live with its queue, and waiting with the delay while a clip is retried', () =>
  Effect.gen(function* () {
    let calls = 0;
    const local = scriptedProvider({
      id: 'local',
      recognition: [whisper],
      batch: (clip) => {
        calls += 1;
        return calls === 1 ? Stream.fail(SpeechFailure.rate('busy', 2_000)) : said(clip);
      },
    });
    const states = yield* inWorld([local], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings: fast });
        yield* play(listening, [...quiet(1, 10), ...loud(10), ...quiet(1, 10)]);
        yield* TestClock.adjust(2_000);
        yield* settle;
        return listening.heard.filter((item): item is TrackState => item._tag === 'State');
      }),
    );
    expect(states.map((state) => [state.phase, state.segment, state.retryInMs, state.queuedMs])).toEqual([
      ['live', 1, undefined, 0],
      ['live', 1, undefined, 200],
      ['waiting', 1, 2_000, 200],
      ['live', 1, undefined, 0],
    ]);
  }),
);

it.effect('a clip the recognizer refuses for good is a gap over the clip and ends the track', () =>
  Effect.gen(function* () {
    const local = scriptedProvider({
      id: 'local',
      recognition: [whisper],
      batch: () => Stream.fail(SpeechFailure.invalidRequest('bad clip')),
    });
    const seen = yield* inWorld([local], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings: fast });
        yield* play(listening, [...quiet(1, 10), ...loud(10), ...quiet(1, 10)]);
        return listening;
      }),
    );
    expect(gaps(seen).map((gap) => [gap.from, gap.to, gap.cause])).toEqual([[200, undefined, 'recognition-failed']]);
    const exit = seen.exit();
    expect(exit !== undefined && Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toMatchObject({
      reason: 'invalid-request',
    });
  }),
);

it.effect('a clip past the queue budget is a budget gap while the recognizer is busy', () =>
  Effect.gen(function* () {
    const local = scriptedProvider({ id: 'local', recognition: [whisper], batch: () => Stream.never });
    const seen = yield* inWorld([local], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings: { ...fast, clipQueueMs: 300 } });
        yield* play(listening, [...quiet(1, 10), ...loud(10), ...quiet(1, 10), ...loud(10), ...quiet(1, 10)]);
        return listening;
      }),
    );
    expect(gaps(seen).map((gap) => [gap.from, gap.to, gap.cause])).toEqual([[600, 800, 'budget']]);
  }),
);

it.effect('a recorded track waits for the busy recognizer instead of losing clips to a budget gap', () =>
  Effect.gen(function* () {
    const local = scriptedProvider({
      id: 'local',
      recognition: [whisper],
      batch: (clip) => Stream.concat(Stream.fromEffectDrain(Effect.sleep(1_000)), said(clip)),
    });
    const settings = { ...fast, clipQueueMs: 300 };
    const seen = yield* inWorld([local], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings, recorded: true });
        yield* play(listening, [...quiet(1, 10), ...loud(10), ...quiet(1, 10), ...loud(10), ...quiet(1, 10)]);
        yield* listening.track.close;
        for (let step = 0; step < 4; step++) {
          yield* TestClock.adjust(1_000);
          yield* settle;
        }
        return listening;
      }),
    );
    expect(gaps(seen)).toEqual([]);
    expect(closed(seen).map((item) => item.span)).toEqual([
      { from: 200, to: 400 },
      { from: 600, to: 800 },
    ]);
    expect(seen.heard.at(-1)?._tag).toBe('Finished');
  }),
);

it.effect('a recognizer that never answers a clip fails it at the clip deadline', () =>
  Effect.gen(function* () {
    const local = scriptedProvider({ id: 'local', recognition: [whisper], batch: () => Stream.never });
    const settings = { ...fast, clipDeadlineMs: 1_000, retry: { ...fast.retry, attempts: 0 } };
    const seen = yield* inWorld([local], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings });
        yield* play(listening, [...quiet(1, 10), ...loud(10), ...quiet(1, 10)]);
        yield* TestClock.adjust(1_000);
        yield* settle;
        return listening;
      }),
    );
    const exit = seen.exit();
    expect(exit !== undefined && Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toMatchObject({ reason: 'transport' });
    expect(gaps(seen).map((gap) => gap.cause)).toEqual(['recognition-failed']);
  }),
);
