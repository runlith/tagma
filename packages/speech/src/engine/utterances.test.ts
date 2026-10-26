import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { streaming } from '../testing/models.ts';
import { scriptedProvider } from '../testing/scriptedProvider.ts';
import { event, inWorld, type Listening, play, ready, settle, word } from '../testing/world.ts';
import { SpeechEvent, type Unit } from '../wire/events.ts';
import type { Gap, Utterance } from '../wire/heard.ts';
import type { RecognitionChoice } from './choose.ts';
import { listeningDefaults } from './settings.ts';

const ms = (value: number) => value * 16;
const closed = (listening: Listening) => listening.heard.filter((item): item is Utterance => item._tag === 'Utterance' && item.closed);
const gaps = (listening: Listening) => listening.heard.filter((item): item is Gap => item._tag === 'Gap');
const untimed = (text: string): Unit => ({ lane: 'source', text, granularity: 'segment' });

const live = streaming('live', { turns: ['provider', 'client', 'none'] });
const provider = scriptedProvider({ id: 'scripted', recognition: [live] });
const as = (turns: RecognitionChoice['turns']): RecognitionChoice => ({ provider: 'scripted', model: live, turns, wants: {} });

it.effect(
  'in mode none the core closes lines on a speaker change, a pause, the length limit, silence after the last word and Finalized',
  () =>
    Effect.gen(function* () {
      const settings = { ...listeningDefaults, splitting: { pauseMs: 300, maxMs: 2_000, lagMs: 200 } };
      const seen = yield* inWorld([provider], (world) =>
        Effect.gen(function* () {
          const listening = yield* world.listen(as('none'), { settings });
          yield* play(
            listening,
            Array.from({ length: 10 }, () => 1),
            1_600,
          );
          const link = yield* world.transport.next;
          yield* link.receive(ready);
          for (const units of [
            [word('hi', ms(0), ms(200), 'A'), word('there', ms(200), ms(400), 'A'), word('yes', ms(400), ms(500), 'B')],
            [word('later', ms(900), ms(1_000), 'B')],
            [word('long', ms(1_000), ms(3_100), 'B')],
          ])
            yield* link.receive(event(SpeechEvent.final('t', units)));
          yield* settle;
          yield* play(
            listening,
            Array.from({ length: 30 }, () => 1),
            1_600,
          );
          const beforeFin = closed(listening).map((item) => item.text);
          yield* link.receive(event(SpeechEvent.final('t', [word('fin', ms(3_800), ms(3_900), 'B')])));
          yield* link.receive(event(SpeechEvent.finalized));
          yield* settle;
          return { listening, beforeFin };
        }),
      );
      expect(seen.beforeFin).toEqual(['hi there', 'yes', 'later', 'long']);
      expect(closed(seen.listening).map((item) => [item.id.seq, item.text, item.speaker])).toEqual([
        [1, 'hi there', 'A'],
        [2, 'yes', 'B'],
        [3, 'later', 'B'],
        [4, 'long', 'B'],
        [5, 'fin', 'B'],
      ]);
    }),
);

it.effect('a line over the length limit is cut at its last sentence end, and never before a sub-word token or punctuation', () =>
  Effect.gen(function* () {
    const settings = { ...listeningDefaults, splitting: { ...listeningDefaults.splitting, maxMs: 2_000 } };
    const token = (text: string, from: number, to: number): Unit => ({
      lane: 'source',
      text,
      granularity: 'token',
      time: { from: ms(from), to: ms(to) },
    });
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(as('provider'), { settings });
        yield* play(
          listening,
          Array.from({ length: 30 }, () => 1),
          1_600,
        );
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        for (const item of [
          SpeechEvent.final('t', [token(' Hello', 0, 300), token(' world', 300, 600), token('.', 600, 650)]),
          SpeechEvent.final('t', [token(' This', 700, 1_000), token(' is', 1_000, 1_300), token(' Nazar', 1_300, 1_900)]),
          SpeechEvent.final('t', [token('ov', 1_900, 2_100), token(',', 2_100, 2_150), token(' friend', 2_200, 2_400)]),
          SpeechEvent.turnEnd('t'),
        ])
          yield* link.receive(event(item));
        yield* settle;
        return listening;
      }),
    );
    expect(closed(seen).map((item) => [item.id.seq, item.text, item.span])).toEqual([
      [1, 'Hello world.', { from: 0, to: 650 }],
      [2, 'This is Nazarov, friend', { from: 700, to: 2_400 }],
    ]);
  }),
);

it.effect('TurnFailed closes a told turn and marks its range as a gap; an untold failed turn gives only the gap and spends its seq', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(as('provider'));
        yield* play(
          listening,
          Array.from({ length: 50 }, () => 1),
        );
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        for (const item of [
          SpeechEvent.final('a', [word('half', ms(0), ms(300))]),
          SpeechEvent.turnFailed('a', 'garbled'),
          SpeechEvent.speechStart('b', ms(400)),
          SpeechEvent.speechEnd('b', ms(600)),
          SpeechEvent.turnFailed('b', 'garbled'),
          SpeechEvent.final('c', [word('next', ms(700), ms(800))]),
          SpeechEvent.turnEnd('c'),
        ])
          yield* link.receive(event(item));
        yield* settle;
        return listening;
      }),
    );
    expect(closed(seen).map((item) => [item.id.seq, item.text])).toEqual([
      [1, 'half'],
      [3, 'next'],
    ]);
    expect(gaps(seen).map((gap) => [gap.from, gap.to, gap.cause])).toEqual([
      [0, 300, 'recognition-failed'],
      [400, 600, 'recognition-failed'],
    ]);
  }),
);

it.effect('provider turns completing out of order keep their opening order, and an untimed turn takes its speech bounds', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(as('provider'));
        yield* play(
          listening,
          Array.from({ length: 50 }, () => 1),
        );
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        for (const item of [
          SpeechEvent.partial('A', 'fir'),
          SpeechEvent.partial('B', 'sec'),
          SpeechEvent.speechStart('B', ms(500)),
          SpeechEvent.speechEnd('B', ms(800)),
          SpeechEvent.final('B', [untimed('second')]),
          SpeechEvent.turnEnd('B'),
          SpeechEvent.final('A', [word('first', ms(100), ms(400))]),
          SpeechEvent.turnEnd('A'),
        ])
          yield* link.receive(event(item));
        yield* settle;
        return listening;
      }),
    );
    expect(closed(seen).map((item) => [item.id.seq, item.text, item.span])).toEqual([
      [2, 'second', { from: 500, to: 800 }],
      [1, 'first', { from: 100, to: 400 }],
    ]);
  }),
);

it.effect('a client-mode turn with timed words takes their time; one without takes its commit range', () =>
  Effect.gen(function* () {
    const settings = {
      ...listeningDefaults,
      segmenter: { start: 0.5, end: 0.35, minSpeechMs: 40, minSilenceMs: 100, preRollMs: 0, maxMs: 20_000 },
    };
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(as('client'), { settings });
        yield* play(listening, [0]);
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        yield* play(listening, [...Array.from({ length: 10 }, () => 2_000), ...Array.from({ length: 6 }, () => 0)]);
        yield* play(listening, [...Array.from({ length: 10 }, () => 2_000), ...Array.from({ length: 6 }, () => 0)]);
        for (const item of [
          SpeechEvent.committed('A', 1),
          SpeechEvent.final('A', [word('timed', ms(40), ms(200))]),
          SpeechEvent.turnEnd('A'),
          SpeechEvent.committed('B', 2),
          SpeechEvent.final('B', [untimed('plain')]),
          SpeechEvent.turnEnd('B'),
        ])
          yield* link.receive(event(item));
        yield* settle;
        return listening;
      }),
    );
    expect(closed(seen).map((item) => [item.text, item.span])).toEqual([
      ['timed', { from: 40, to: 200 }],
      ['plain', { from: 320, to: 640 }],
    ]);
  }),
);
