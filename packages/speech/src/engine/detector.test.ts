import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Exit, Layer, Stream } from 'effect';
import { batching, streaming } from '../testing/models.ts';
import { scriptedProvider } from '../testing/scriptedProvider.ts';
import { inWorld, play, settle } from '../testing/world.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { RecognitionChoice } from './choose.ts';
import { SpeechDetector } from './SpeechDetector.ts';

const live = streaming('live');
const local = batching('local');
const provider = scriptedProvider({ id: 'scripted', recognition: [live, local], batch: () => Stream.empty });

const unopened = Layer.succeed(SpeechDetector, {
  availability: Effect.succeed({ _tag: 'present' } as const),
  open: Effect.fail(SpeechFailure.unsupported('the engine did not report ready in time')),
});

const failed = (choice: RecognitionChoice) =>
  inWorld(
    [provider],
    (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, {});
        yield* play(listening, [2_000, 2_000]);
        yield* settle;
        return {
          gaps: listening.heard.flatMap((item) =>
            item._tag === 'Gap' ? [[item.cause, item.to, item.message.endsWith('the engine did not report ready in time')]] : [],
          ),
          failed: listening.exit() !== undefined && Exit.isFailure(listening.exit()!),
        };
      }),
    unopened,
  );

it.effect('a detector that does not open leaves a recognition-failed gap before the track fails, on both roads', () =>
  Effect.gen(function* () {
    const roads = [
      yield* failed({ provider: 'scripted', model: local, turns: 'client', wants: {} }),
      yield* failed({ provider: 'scripted', model: live, turns: 'client', wants: {} }),
    ];
    expect(roads).toEqual([
      { gaps: [['recognition-failed', undefined, true]], failed: true },
      { gaps: [['recognition-failed', undefined, true]], failed: true },
    ]);
  }),
);
