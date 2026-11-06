import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Exit, Fiber, Scope, Stream } from 'effect';
import { batching, filing, streaming } from '../testing/models.ts';
import { LIVE, RECORDED } from '../wire/capabilities.ts';
import { controlOf, incoming, scriptedProvider } from '../testing/scriptedProvider.ts';
import { type Listening, inWorld, settle } from '../testing/world.ts';
import { SpeechEvent, type Unit } from '../wire/events.ts';
import type { Utterance } from '../wire/heard.ts';
import type { RecognitionChoice } from './choose.ts';
import { listeningDefaults } from './settings.ts';
import { SpeechDetector } from './SpeechDetector.ts';

const live = streaming('live');
const provider = scriptedProvider({ id: 'scripted', recognition: [live] });

const word = (text: string, from: number, to: number): Unit => ({
  lane: 'source',
  text,
  granularity: 'word',
  time: { from, to },
});

const segment = (text: string): Unit => ({ lane: 'source', text, granularity: 'segment' });

const event = (item: SpeechEvent) => incoming({ type: 'event', event: item });

const speak = Effect.fnUntraced(function* (listening: Listening, pattern: ReadonlyArray<readonly [number, number]>) {
  for (const [chunks, level] of pattern) {
    for (let index = 0; index < chunks; index++) {
      yield* listening.track.play(new Int16Array(320).fill(level));
      yield* settle;
    }
  }
});

const utterances = (listening: Listening) => listening.heard.filter((item): item is Utterance => item._tag === 'Utterance');

it.effect('finals and partials of one turn, then its end, make one utterance with nothing doubled or lost', () =>
  Effect.gen(function* () {
    const choice: RecognitionChoice = { provider: 'scripted', model: live, turns: 'provider', wants: {} };
    const told = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice);
        yield* speak(listening, [[10, 2_000]]);
        const link = yield* world.transport.next;
        for (const frame of [
          incoming({ type: 'ready' }),
          event(SpeechEvent.partial('t', 'hel')),
          event(SpeechEvent.final('t', [word('hello', 0, 1_600)])),
          event(SpeechEvent.partial('t', 'wor')),
          event(SpeechEvent.final('t', [word('world', 1_600, 3_200)])),
          event(SpeechEvent.turnEnd('t')),
        ])
          yield* link.receive(frame);
        yield* settle;
        return utterances(listening);
      }),
    );
    expect(told.map((item) => item.id)).toEqual(told.map(() => ({ track: 'mic', segment: 1, seq: 1 })));
    expect(told.map((item) => [item.revision, item.closed, item.text, item.hypothesis])).toEqual([
      [1, false, '', 'hel'],
      [2, false, 'hello', ''],
      [3, false, 'hello', 'wor'],
      [4, false, 'hello world', ''],
      [5, true, 'hello world', ''],
    ]);
    expect(told.at(-1)?.span).toEqual({ from: 0, to: 200 });
    expect(told.at(-1)?.units).toHaveLength(2);
  }),
);

it.effect('B completing before A while C is still partial keeps the order, time and identity of all three', () =>
  Effect.gen(function* () {
    const choice: RecognitionChoice = { provider: 'scripted', model: live, turns: 'client', wants: {} };
    const settings = {
      ...listeningDefaults,
      segmenter: { start: 0.5, end: 0.35, minSpeechMs: 40, minSilenceMs: 100, preRollMs: 0, maxMs: 20_000 },
    };
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings });
        yield* listening.track.play(new Int16Array(320));
        const link = yield* world.transport.next;
        yield* link.receive(incoming({ type: 'ready' }));
        yield* speak(listening, [
          [10, 2_000],
          [6, 0],
          [10, 2_000],
          [6, 0],
          [5, 2_000],
        ]);
        for (const item of [
          SpeechEvent.committed('A', 1),
          SpeechEvent.committed('B', 2),
          SpeechEvent.partial('C', 'thi'),
          SpeechEvent.final('B', [segment('second')]),
          SpeechEvent.turnEnd('B'),
          SpeechEvent.final('A', [segment('first')]),
          SpeechEvent.turnEnd('A'),
        ])
          yield* link.receive(event(item));
        yield* settle;
        return { told: utterances(listening), commits: link.sent.map(controlOf).filter((sent) => sent?.['type'] === 'commit') };
      }),
    );
    expect(seen.commits).toEqual([
      { type: 'commit', commit: 1 },
      { type: 'commit', commit: 2 },
    ]);
    const closed = seen.told.filter((item) => item.closed);
    expect(closed.map((item) => [item.id.seq, item.text, item.span])).toEqual([
      [2, 'second', { from: 320, to: 640 }],
      [1, 'first', { from: 0, to: 320 }],
    ]);
    const third = seen.told.filter((item) => item.id.seq === 3);
    expect(third.map((item) => [item.id.segment, item.closed, item.hypothesis])).toEqual([[1, false, 'thi']]);
  }),
);

it.effect('a batch model hears the track in clips cut by the Segmenter, each timed from its own start', () =>
  Effect.gen(function* () {
    const whisper = batching('whisper');
    const clipped: Array<number> = [];
    const local = scriptedProvider({
      id: 'local',
      recognition: [whisper],
      batch: (clip) => {
        clipped.push(clip.pcm.length);
        return Stream.fromIterable([
          SpeechEvent.final('0', [{ lane: 'source', text: 'clip', granularity: 'segment', time: { from: 0, to: clip.pcm.length } }]),
          SpeechEvent.turnEnd('0'),
        ]);
      },
    });
    const settings = {
      ...listeningDefaults,
      segmenter: { start: 0.5, end: 0.35, minSpeechMs: 40, minSilenceMs: 100, preRollMs: 0, maxMs: 20_000 },
    };
    const heard = yield* inWorld([local], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen({ provider: 'local', model: whisper, turns: 'client', wants: {} }, { settings });
        yield* speak(listening, [
          [10, 0],
          [20, 2_000],
          [10, 0],
        ]);
        yield* listening.track.close;
        yield* settle;
        return listening.heard.filter((item) => item._tag !== 'State');
      }),
    );
    expect(clipped).toEqual([6_400]);
    expect(heard.map((item) => (item._tag === 'Utterance' ? [item.closed, item.text, item.span] : item._tag))).toEqual([
      [false, 'clip', { from: 200, to: 600 }],
      [true, 'clip', { from: 200, to: 600 }],
      'Finished',
    ]);
  }),
);

it.effect('a provider with inconsistent capabilities or a taken id is left out with its fault, and the others stand', () =>
  Effect.gen(function* () {
    const broken = scriptedProvider({ id: 'broken', recognition: [streaming('x', { turns: [] })] });
    const set = yield* inWorld([broken, provider], (world) =>
      world.reload([
        { owner: 'first', providers: [broken, provider] },
        { owner: 'second', providers: [scriptedProvider({ id: 'scripted', recognition: [streaming('other')] })] },
        { owner: 'third', providers: [], failure: 'its module threw on import' },
      ]),
    );
    expect(set.recognition.map((offer) => `${offer.provider}/${offer.model.id}`)).toEqual(['scripted/live']);
    expect(set.faults.map((fault) => [fault.owner, fault.provider])).toEqual([
      ['first', 'broken'],
      ['second', 'scripted'],
      ['third', ''],
    ]);
    expect(set.faults[1]?.reason).toContain('first');
  }),
);

it.effect('a recognition keeps the set it started on through a reload, and the next work reads the new set', () =>
  Effect.gen(function* () {
    const choice: RecognitionChoice = { provider: 'scripted', model: live, turns: 'provider', wants: {} };
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice);
        yield* speak(listening, [[4, 2_000]]);
        const link = yield* world.transport.next;
        const next = yield* world.reload([]);
        for (const frame of [
          incoming({ type: 'ready' }),
          event(SpeechEvent.final('t', [word('kept', 0, 1_200)])),
          event(SpeechEvent.turnEnd('t')),
        ])
          yield* link.receive(frame);
        yield* settle;
        const refused = yield* Effect.flip(Stream.runDrain(next.recognize(choice, listening.track.track, { track: 'mic', origin: 0n })));
        return { told: utterances(listening), offered: next.recognition.length, refused: refused.message };
      }),
    );
    expect(seen.told.at(-1)?.text).toBe('kept');
    expect(seen.told.at(-1)?.closed).toBe(true);
    expect(seen.offered).toBe(0);
    expect(seen.refused).toContain('not a registered recognizer');
  }),
);

it.effect('work holding a set keeps its revision standing through a reload, and its end releases it', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([], (world) =>
      Effect.gen(function* () {
        yield* world.reload([{ owner: 'plugin', revision: 'A', providers: [provider] }]);
        const work = yield* Scope.make();
        yield* Scope.provide(world.service.take, work);
        yield* world.reload([{ owner: 'plugin', revision: 'B', providers: [provider] }]);
        const during = [...world.service.revisions()].sort();
        const released = yield* Effect.forkChild(Stream.runHead(world.service.released));
        yield* settle;
        yield* Scope.close(work, Exit.void);
        yield* Fiber.join(released);
        return { during, after: [...world.service.revisions()] };
      }),
    );
    expect(seen).toEqual({ during: ['A', 'B'], after: ['B'] });
  }),
);

it.effect('the choice explains every rejected model', () =>
  Effect.gen(function* () {
    const cloud = scriptedProvider({ id: 'cloud', recognition: [streaming('only-provider', { turns: ['provider'] })] });
    const local = scriptedProvider({ id: 'local', recognition: [batching('whisper')], batch: () => Stream.empty });
    const missing = scriptedProvider({
      id: 'remote',
      recognition: [streaming('far')],
      availability: () => ({ _tag: 'absent', reason: 'the model is not downloaded', unblock: [] }),
    });
    const refused = yield* inWorld(
      [cloud, local, missing],
      (world) =>
        Effect.gen(function* () {
          const client = yield* Effect.flip(world.speech.recognizer({ kinds: LIVE, turns: 'client', languages: ['ru'] }));
          const onlyLocal = yield* Effect.flip(world.speech.recognizer({ kinds: LIVE, provider: 'local' }));
          return { client, onlyLocal };
        }),
      SpeechDetector.none('the engine is not built', ['build the engine']),
    );
    const detector = 'turn mode client needs the speech detector: the engine is not built';
    expect(refused.client.rejected).toEqual([
      { provider: 'cloud', model: 'only-provider', reason: 'turn mode client is not offered', unblock: [] },
      { provider: 'local', model: 'whisper', reason: detector, unblock: ['build the engine'] },
      { provider: 'remote', model: 'far', reason: detector, unblock: ['build the engine'] },
    ]);
    expect(refused.onlyLocal.rejected.map((rejection) => rejection.provider)).toEqual(['local']);
  }),
);

it.effect('a live need passes over a file model, and a need for a recorded track over a stream model', () =>
  Effect.gen(function* () {
    const cloud = scriptedProvider({ id: 'cloud', recognition: [filing('async'), streaming('live')], file: () => Stream.empty });
    const local = scriptedProvider({ id: 'local', recognition: [batching('whisper')], batch: () => Stream.empty });
    const chosen = yield* inWorld([cloud, local], (world) =>
      Effect.gen(function* () {
        const live = yield* world.speech.recognizer({ kinds: LIVE });
        const recorded = yield* world.speech.recognizer({ kinds: RECORDED });
        const offline = yield* world.speech.recognizer({ kinds: RECORDED, provider: 'local' });
        const refused = yield* Effect.flip(world.speech.recognizer({ kinds: RECORDED, provider: 'cloud', model: 'live' }));
        return [live.model.id, recorded.model.id, offline.model.id, refused.rejected.map((rejection) => rejection.reason)];
      }),
    );
    expect(chosen).toEqual(['live', 'async', 'whisper', ['it is a stream model']]);
  }),
);

it.effect('the choice names the capability that rules each candidate out', () =>
  Effect.gen(function* () {
    const reasons = yield* inWorld([provider], (world) =>
      Effect.forEach(
        [
          { kinds: ['batch'] },
          { kinds: LIVE, speakers: true },
          { kinds: LIVE, languages: ['de'] },
          { kinds: LIVE, languages: ['en', 'ru', 'en-GB'] },
          { kinds: LIVE, translation: { _tag: 'one-way', target: 'fr' } },
          { kinds: LIVE, prompt: 'a meeting' },
          { kinds: LIVE, tuning: { gain: 1 } },
          { kinds: LIVE, turns: 'none' },
        ] as const,
        (need) => Effect.map(Effect.flip(world.speech.recognizer(need)), (refused) => refused.rejected[0]?.reason),
      ),
    );
    expect(reasons).toEqual([
      'it is a stream model',
      'it does not tell speakers apart',
      'it does not recognize de',
      'it takes at most 2 language hints',
      'it does not translate',
      'it takes no prompt',
      'it has no tuning knob gain',
      'turn mode none is not offered',
    ]);
  }),
);
