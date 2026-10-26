import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Exit, Stream } from 'effect';
import { batching, streaming } from '../testing/models.ts';
import { scriptedProvider } from '../testing/scriptedProvider.ts';
import { event, inWorld, play, ready, settle, word } from '../testing/world.ts';
import { SpeechEvent } from '../wire/events.ts';
import type { Heard } from '../wire/heard.ts';
import type { RecognitionChoice } from './choose.ts';

const live = streaming('live');
const local = batching('local');
const pending = Deferred.makeUnsafe<void>();
const provider = scriptedProvider({
  id: 'scripted',
  recognition: [live, local],
  batch: () => Stream.fromEffect(Deferred.await(pending)).pipe(Stream.flatMap(() => Stream.empty)),
});

const outcome = (heard: ReadonlyArray<Heard>) => ({
  gaps: heard.flatMap((item) => (item._tag === 'Gap' ? [[item.cause, item.from, item.to]] : [])),
  finished: heard.some((item) => item._tag === 'Finished'),
});

it.effect('a cut stream ends at once with the unconfirmed tail as a gap and without Finished', () =>
  Effect.gen(function* () {
    const choice: RecognitionChoice = { provider: 'scripted', model: live, turns: 'provider', wants: {} };
    const ended = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const cut = yield* Deferred.make<void>();
        const listening = yield* world.listen(choice, { cut: Deferred.await(cut) });
        yield* play(
          listening,
          Array.from({ length: 10 }, () => 2_000),
        );
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        yield* link.receive(event(SpeechEvent.final('t1', [word('one', 0, 1_600)])));
        yield* settle;
        yield* Deferred.succeed(cut, undefined);
        yield* settle;
        return { ...outcome(listening.heard), exit: listening.exit() };
      }),
    );
    expect(ended.gaps).toEqual([['unconfirmed-tail', 100, 200]]);
    expect(ended.finished).toBe(false);
    expect(ended.exit !== undefined && Exit.isSuccess(ended.exit)).toBe(true);
  }),
);

it.effect('a cut clip road ends at once with the audio no clip recognized as a gap', () =>
  Effect.gen(function* () {
    const choice: RecognitionChoice = { provider: 'scripted', model: local, turns: 'client', wants: {} };
    const ended = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const cut = yield* Deferred.make<void>();
        const listening = yield* world.listen(choice, { cut: Deferred.await(cut) });
        yield* play(
          listening,
          Array.from({ length: 20 }, () => 2_000),
        );
        yield* Deferred.succeed(cut, undefined);
        yield* settle;
        return { ...outcome(listening.heard), exit: listening.exit() };
      }),
    );
    expect(ended.gaps.map(([cause]) => cause)).toEqual(['unconfirmed-tail']);
    expect(ended.finished).toBe(false);
    expect(ended.exit !== undefined && Exit.isSuccess(ended.exit)).toBe(true);
  }),
);
