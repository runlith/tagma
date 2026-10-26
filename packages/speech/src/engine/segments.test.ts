import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Exit } from 'effect';
import { TestClock } from 'effect/testing';
import { streaming } from '../testing/models.ts';
import { controlOf, incoming, pcmOf, scriptedProvider } from '../testing/scriptedProvider.ts';
import type { ScriptedLink } from '../testing/ScriptedTransport.ts';
import { inWorld, type Listening, settle } from '../testing/world.ts';
import { SpeechEvent, type Unit } from '../wire/events.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { Gap, Utterance } from '../wire/heard.ts';
import type { RecognitionChoice } from './choose.ts';
import { type ListeningSettings, listeningDefaults } from './settings.ts';

const live = streaming('live');
const provider = scriptedProvider({ id: 'scripted', recognition: [live] });
const choice: RecognitionChoice = { provider: 'scripted', model: live, turns: 'provider', wants: {} };

const word = (text: string, from: number, to: number): Unit => ({ lane: 'source', text, granularity: 'word', time: { from, to } });
const event = (item: SpeechEvent) => incoming({ type: 'event', event: item });
const ready = incoming({ type: 'ready' });

const play = Effect.fnUntraced(function* (listening: Listening, values: ReadonlyArray<number>) {
  for (const value of values) {
    yield* listening.track.play(new Int16Array(320).fill(value));
    yield* settle;
  }
});

const timed = (listening: Listening, values: ReadonlyArray<number>) =>
  Effect.forEach(values, (value) => Effect.andThen(play(listening, [value]), TestClock.adjust(20)), { discard: true });

const audio = (link: ScriptedLink) =>
  link.sent.flatMap((message) => {
    const pcm = pcmOf(message);
    return pcm === undefined ? [] : [pcm[0]];
  });

const turn = Effect.fnUntraced(function* (link: ScriptedLink, key: string, from: number) {
  yield* link.receive(event(SpeechEvent.final(key, [word(key, from, from + 320)])));
  yield* link.receive(event(SpeechEvent.turnEnd(key)));
  yield* settle;
});

const gaps = (listening: Listening) => listening.heard.filter((item): item is Gap => item._tag === 'Gap');
const closed = (listening: Listening) => listening.heard.filter((item): item is Utterance => item._tag === 'Utterance' && item.closed);

const failureOf = (listening: Listening) => {
  const exit = listening.exit();
  return exit !== undefined && Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
};

const settings = (changes: Partial<ListeningSettings>): ListeningSettings => ({ ...listeningDefaults, ...changes });

it.effect('audio before ready arrives, the budget overflow is a gap that closes the segment, and the next segment keeps counting', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings: settings({ budgetMs: 50 }) });
        yield* play(listening, [1, 2]);
        const first = yield* world.transport.next;
        const before = audio(first);
        yield* first.receive(ready);
        yield* settle;
        yield* play(listening, [3, 4]);
        yield* turn(first, 'a', 0);
        first.setBuffered(1_280);
        yield* play(listening, [5]);
        const second = yield* world.transport.next;
        yield* second.receive(ready);
        yield* settle;
        yield* turn(second, 'a', 0);
        return { before, first: audio(first), second: audio(second), listening };
      }),
    );
    expect(seen.before).toEqual([]);
    expect(seen.first).toEqual([1, 2, 3, 4]);
    expect(seen.second).toEqual([5]);
    expect(gaps(seen.listening).map((gap) => [gap.from, gap.to, gap.cause])).toEqual([[20, 80, 'budget']]);
    expect(closed(seen.listening).map((item) => item.id)).toEqual([
      { track: 'mic', segment: 1, seq: 1 },
      { track: 'mic', segment: 2, seq: 2 },
    ]);
  }),
);

it.effect('finishing waits for the provider Finished, and without it in time the tail is an unconfirmed gap', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const confirmed = yield* world.listen(choice);
        yield* play(confirmed, [1, 2]);
        const first = yield* world.transport.next;
        yield* first.receive(ready);
        yield* confirmed.track.close;
        yield* settle;
        const finish = first.sent.map(controlOf).at(-1);
        yield* turn(first, 'a', 0);
        const before = confirmed.heard.at(-1)?._tag;
        yield* first.receive(event(SpeechEvent.finished));
        yield* settle;
        const unconfirmed = yield* world.listen(choice);
        yield* play(unconfirmed, [1, 2]);
        const second = yield* world.transport.next;
        yield* second.receive(ready);
        yield* turn(second, 'a', 0);
        yield* unconfirmed.track.close;
        yield* settle;
        yield* TestClock.adjust(listeningDefaults.finishMs);
        yield* settle;
        return { finish, before, confirmed, unconfirmed };
      }),
    );
    expect(seen.finish).toEqual({ type: 'finish' });
    expect(seen.before).toBe('Utterance');
    expect(seen.confirmed.heard.at(-1)?._tag).toBe('Finished');
    expect(seen.confirmed.exit()?._tag).toBe('Success');
    expect(seen.unconfirmed.heard.map((item) => item._tag)).not.toContain('Finished');
    expect(gaps(seen.unconfirmed).map((gap) => [gap.from, gap.to, gap.cause])).toEqual([[20, 40, 'unconfirmed-tail']]);
    expect(seen.unconfirmed.exit()?._tag).toBe('Success');
  }),
);

it.effect('stopping while the connection opens leaves no connection behind', () =>
  Effect.gen(function* () {
    const live = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const gate = yield* world.transport.hold;
        const listening = yield* world.listen(choice);
        yield* play(listening, [1]);
        yield* listening.stop;
        yield* Deferred.succeed(gate, undefined);
        yield* settle;
        return world.transport.live();
      }),
    );
    expect(live).toBe(0);
  }),
);

it.effect('a reconnect waits its backoff and the provider retry-after, and the track ends past the attempts limit', () =>
  Effect.gen(function* () {
    const retry = { baseMs: 1_000, capMs: 8_000, attempts: 2 };
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings: settings({ retry }) });
        const links: Array<ScriptedLink> = [];
        const opened = (link: ScriptedLink) => Effect.sync(() => links.push(link));
        yield* play(listening, [1]);
        yield* Effect.flatMap(world.transport.next, opened);
        yield* links[0]!.receive(ready);
        yield* links[0]!.drop(SpeechFailure.transport('reset'));
        yield* settle;
        yield* play(listening, [2]);
        const waitedBase = links.length;
        yield* TestClock.adjust(retry.baseMs);
        yield* play(listening, [3]);
        yield* Effect.flatMap(world.transport.next, opened);
        yield* links[1]!.receive(ready);
        yield* links[1]!.receive(event(SpeechEvent.partial('a', 'hel')));
        yield* settle;
        yield* links[1]!.receive(incoming({ type: 'error', reason: 'rate', message: 'slow down', retryAfterMs: 5_000 }));
        yield* settle;
        yield* TestClock.adjust(2_000);
        yield* play(listening, [4]);
        const waitedRetryAfter = links.length;
        yield* TestClock.adjust(3_000);
        yield* play(listening, [5]);
        yield* Effect.flatMap(world.transport.next, opened);
        yield* links[2]!.drop(SpeechFailure.transport('reset'));
        yield* settle;
        yield* TestClock.adjust(2_000);
        yield* play(listening, [6]);
        yield* Effect.flatMap(world.transport.next, opened);
        yield* links[3]!.drop(SpeechFailure.transport('reset'));
        yield* settle;
        return { waitedBase, waitedRetryAfter, links, listening };
      }),
    );
    expect([seen.waitedBase, seen.waitedRetryAfter, seen.links.length]).toEqual([1, 2, 4]);
    expect(seen.links.map(audio)).toEqual([[1], [3], [], []]);
    expect(gaps(seen.listening).map((gap) => [gap.from, gap.to, gap.cause])).toEqual([
      [0, 40, 'reconnect'],
      [40, 80, 'reconnect'],
      [80, 100, 'reconnect'],
      [100, undefined, 'recognition-failed'],
    ]);
    expect(closed(seen.listening).map((item) => [item.id.seq, item.text])).toEqual([[1, '']]);
    expect(failureOf(seen.listening)).toMatchObject({ reason: 'transport' });
  }),
);

it.effect('a planned switch at the provider session limit sends no range of audio to both connections', () =>
  Effect.gen(function* () {
    const rolling = streaming('rolling', { turns: ['provider'], limits: { sessionMs: 1_000 } });
    const roller = scriptedProvider({ id: 'roller', recognition: [rolling] });
    const values = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
    const seen = yield* inWorld([roller], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(
          { provider: 'roller', model: rolling, turns: 'provider', wants: {} },
          { settings: settings({ rollover: { leadMs: 400, marginMs: 100 } }) },
        );
        yield* timed(listening, [1]);
        const first = yield* world.transport.next;
        yield* first.receive(ready);
        yield* timed(listening, values(2, 39));
        const second = yield* world.transport.next;
        yield* second.receive(ready);
        yield* turn(first, 'a', 0);
        yield* timed(listening, values(40, 44));
        yield* first.receive(event(SpeechEvent.finished));
        yield* turn(second, 'b', 0);
        yield* settle;
        return { first, second, listening };
      }),
    );
    expect(audio(seen.first)).toEqual(values(1, 39));
    expect(audio(seen.second)).toEqual(values(40, 44));
    expect(seen.first.sent.map(controlOf).at(-1)).toEqual({ type: 'finish' });
    expect(gaps(seen.listening)).toEqual([]);
    expect(closed(seen.listening).map((item) => [item.id.segment, item.span?.from])).toEqual([
      [1, 0],
      [2, 780],
    ]);
  }),
);

it.effect('an auth refusal ends the track at once', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice);
        yield* play(listening, [1]);
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        yield* link.receive(incoming({ type: 'error', reason: 'auth', message: 'bad key' }));
        yield* settle;
        yield* play(listening, [2]);
        return { listening, live: world.transport.live() };
      }),
    );
    expect(failureOf(seen.listening)).toMatchObject({ reason: 'auth' });
    expect(seen.live).toBe(0);
  }),
);

it.effect('a provider Finished before the track ends loses its connection: the next audio reconnects and the lost stretch is a gap', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice);
        yield* play(listening, [1]);
        const first = yield* world.transport.next;
        yield* first.receive(ready);
        yield* first.receive(event(SpeechEvent.finished));
        yield* settle;
        yield* play(listening, [2]);
        yield* TestClock.adjust(listeningDefaults.retry.baseMs);
        yield* play(listening, [3]);
        const second = yield* world.transport.next;
        yield* second.receive(ready);
        yield* settle;
        return { listening, second: audio(second) };
      }),
    );
    expect(gaps(seen.listening).map((gap) => [gap.from, gap.to, gap.cause])).toEqual([[0, 40, 'reconnect']]);
    expect(seen.second).toEqual([3]);
  }),
);
