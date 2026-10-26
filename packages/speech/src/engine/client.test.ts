import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { streaming } from '../testing/models.ts';
import { controlOf, incoming, pcmOf, scriptedProvider } from '../testing/scriptedProvider.ts';
import type { ScriptedLink } from '../testing/ScriptedTransport.ts';
import { event, inWorld, type Listening, play, ready, settle } from '../testing/world.ts';
import { SpeechEvent, type Unit } from '../wire/events.ts';
import type { Gap, Utterance } from '../wire/heard.ts';
import type { RecognitionChoice } from './choose.ts';
import { listeningDefaults } from './settings.ts';

const untimed = (text: string): Unit => ({ lane: 'source', text, granularity: 'segment' });
const loud = (count: number) => Array.from({ length: count }, () => 2_000);
const silent = (count: number) => Array.from({ length: count }, () => 0);
const fast = {
  ...listeningDefaults,
  segmenter: { start: 0.5, end: 0.35, minSpeechMs: 40, minSilenceMs: 100, preRollMs: 0, maxMs: 20_000 },
};
const gaps = (listening: Listening) =>
  listening.heard.filter((item): item is Gap => item._tag === 'Gap').map((gap) => [gap.from, gap.to, gap.cause]);
const closed = (listening: Listening) => listening.heard.filter((item): item is Utterance => item._tag === 'Utterance' && item.closed);
const controls = (link: ScriptedLink) =>
  link.sent
    .map(controlOf)
    .filter((sent) => sent !== undefined)
    .slice(1);
const timed = (listening: Listening, values: ReadonlyArray<number>) =>
  Effect.forEach(values, (value) => Effect.andThen(play(listening, [value]), TestClock.adjust(20)), { discard: true });

const live = streaming('live', { turns: ['client'] });
const provider = scriptedProvider({ id: 'scripted', recognition: [live] });
const choice: RecognitionChoice = { provider: 'scripted', model: live, turns: 'client', wants: {} };

it.effect('closing a client-mode track commits its tail, finishes and ends with Finished', () =>
  Effect.gen(function* () {
    const heard = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings: fast });
        yield* play(listening, [0]);
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        yield* play(listening, loud(10));
        yield* listening.track.close;
        yield* settle;
        const sent = controls(link);
        yield* link.receive(event(SpeechEvent.committed('A', 1)));
        yield* link.receive(event(SpeechEvent.final('A', [untimed('tail')])));
        yield* link.receive(event(SpeechEvent.turnEnd('A')));
        yield* link.receive(event(SpeechEvent.finished));
        yield* settle;
        return { sent, listening };
      }),
    );
    expect(heard.sent).toEqual([{ type: 'commit', commit: 1 }, { type: 'finish' }]);
    expect(closed(heard.listening).map((item) => [item.text, item.span])).toEqual([['tail', { from: 0, to: 220 }]]);
    expect(heard.listening.heard.at(-1)?._tag).toBe('Finished');
  }),
);

it.effect('a turn committed but never completed is inside the unconfirmed tail, even when a later turn completed', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings: fast });
        yield* play(listening, [0]);
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        yield* play(listening, [...loud(10), ...silent(6), ...loud(10), ...silent(6)]);
        for (const item of [
          SpeechEvent.committed('A', 1),
          SpeechEvent.committed('B', 2),
          SpeechEvent.final('B', [untimed('second')]),
          SpeechEvent.turnEnd('B'),
        ])
          yield* link.receive(event(item));
        yield* listening.track.close;
        yield* settle;
        yield* TestClock.adjust(listeningDefaults.finishMs);
        yield* settle;
        return listening;
      }),
    );
    expect(gaps(seen)).toEqual([[0, 660, 'unconfirmed-tail']]);
  }),
);

it.effect('a client-mode switch at the session margin commits all the old connection heard before it finishes', () =>
  Effect.gen(function* () {
    const rolling = streaming('rolling', { turns: ['client'], limits: { sessionMs: 1_000 } });
    const roller = scriptedProvider({ id: 'roller', recognition: [rolling] });
    const values = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => 2_000 + from + index);
    const seen = yield* inWorld([roller], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(
          { provider: 'roller', model: rolling, turns: 'client', wants: {} },
          { settings: { ...listeningDefaults, rollover: { leadMs: 400, marginMs: 100 } } },
        );
        yield* timed(listening, values(1, 1));
        const first = yield* world.transport.next;
        yield* first.receive(ready);
        yield* timed(listening, values(2, 39));
        const second = yield* world.transport.next;
        yield* second.receive(ready);
        yield* timed(listening, values(40, 55));
        yield* first.receive(event(SpeechEvent.committed('A', 1)));
        yield* first.receive(event(SpeechEvent.final('A', [untimed('all of it')])));
        yield* first.receive(event(SpeechEvent.turnEnd('A')));
        yield* first.receive(event(SpeechEvent.finished));
        yield* settle;
        const heardBy = (link: ScriptedLink) => link.sent.flatMap((message) => [pcmOf(message)?.[0] ?? []].flat());
        return { first: heardBy(first), second: heardBy(second), controls: controls(first), listening };
      }),
    );
    expect(seen.controls).toEqual([{ type: 'commit', commit: 1 }, { type: 'finish' }]);
    expect(seen.first).toEqual(values(1, 49));
    expect(seen.second).toEqual(values(50, 55));
    expect(closed(seen.listening).map((item) => [item.text, item.span])).toEqual([['all of it', { from: 0, to: 980 }]]);
  }),
);

it.effect('losing the current connection while one is prepared moves the audio to the prepared one without a wait', () =>
  Effect.gen(function* () {
    const rolling = streaming('rolling', { turns: ['provider'], limits: { sessionMs: 1_000 } });
    const roller = scriptedProvider({ id: 'roller', recognition: [rolling] });
    const seen = yield* inWorld([roller], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(
          { provider: 'roller', model: rolling, turns: 'provider', wants: {} },
          {
            settings: { ...listeningDefaults, rollover: { leadMs: 400, marginMs: 100 } },
          },
        );
        yield* timed(listening, [1]);
        const first = yield* world.transport.next;
        yield* first.receive(ready);
        yield* timed(listening, loud(38));
        const second = yield* world.transport.next;
        yield* second.receive(ready);
        yield* first.receive(incoming({ type: 'error', reason: 'transport', message: 'reset' }));
        yield* settle;
        yield* timed(listening, [7, 8]);
        const heardBy = second.sent.flatMap((message) => [pcmOf(message)?.[0] ?? []].flat());
        return { heardBy, live: world.transport.live() };
      }),
    );
    expect(seen).toEqual({ heardBy: [7, 8], live: 1 });
  }),
);

it.effect('a prepared connection drained before it heard anything leaves no tail gap', () =>
  Effect.gen(function* () {
    const rolling = streaming('rolling', { turns: ['provider'], limits: { sessionMs: 1_000 } });
    const roller = scriptedProvider({ id: 'roller', recognition: [rolling] });
    const seen = yield* inWorld([roller], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(
          { provider: 'roller', model: rolling, turns: 'provider', wants: {} },
          {
            settings: { ...listeningDefaults, rollover: { leadMs: 400, marginMs: 100 } },
          },
        );
        yield* timed(listening, [1]);
        const first = yield* world.transport.next;
        yield* first.receive(ready);
        yield* timed(listening, loud(38));
        yield* world.transport.next;
        yield* listening.track.skip(100, 'device-change');
        yield* listening.track.skip(100, 'device-change');
        yield* settle;
        yield* first.receive(event(SpeechEvent.finished));
        yield* TestClock.adjust(listeningDefaults.finishMs);
        yield* settle;
        return listening;
      }),
    );
    expect(gaps(seen).map(([, , cause]) => cause)).toEqual(['device-change', 'device-change']);
  }),
);

it.effect('a refused prepared connection is retried only after its retry-after', () =>
  Effect.gen(function* () {
    const rolling = streaming('rolling', { turns: ['provider'], limits: { sessionMs: 1_000 } });
    const roller = scriptedProvider({ id: 'roller', recognition: [rolling] });
    const opened = yield* inWorld([roller], (world) =>
      Effect.gen(function* () {
        const links: Array<ScriptedLink> = [];
        const collector = yield* Effect.forkChild(Effect.forever(Effect.map(world.transport.next, (link) => links.push(link))));
        const listening = yield* world.listen(
          { provider: 'roller', model: rolling, turns: 'provider', wants: {} },
          {
            settings: { ...listeningDefaults, rollover: { leadMs: 400, marginMs: 100 } },
          },
        );
        yield* timed(listening, loud(39));
        yield* settle;
        yield* links[0]!.receive(ready);
        yield* links[1]!.receive(incoming({ type: 'error', reason: 'rate', message: 'too many', retryAfterMs: 5_000 }));
        yield* settle;
        yield* timed(listening, loud(40));
        const during = links.length;
        yield* TestClock.adjust(5_000);
        yield* timed(listening, loud(1));
        yield* settle;
        yield* Fiber.interrupt(collector);
        return { during, after: links.length };
      }),
    );
    expect(opened).toEqual({ during: 2, after: 3 });
  }),
);
