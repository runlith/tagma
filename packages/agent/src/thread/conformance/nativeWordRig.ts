import { Effect } from 'effect';
import { hold, opened, quiet, started } from './compactionWorld';
import type { ThreadStorageFactory } from './storagePort';
import type { Unreachable } from './transportStops';
import type { WordCase, WordRig, WordState } from './transportWords';

const unreached = (unreachable: string): Unreachable => ({ unreachable });

export const nativeWordRig = <TTx, TWrite extends TTx = TTx, R = never>(open: ThreadStorageFactory<TTx, TWrite, R>): WordRig<R> => ({
  reach: Effect.fnUntraced(function* (state: WordState) {
    if (state === 'reopening') return unreached('a native thread holds no vendor session to reopen');
    const resting = new Set<string>();
    const { world, threadId, handle } = yield* opened(open, { resting });
    const answering = hold();
    const wordCase = (during: WordCase['during'], woken: Effect.Effect<unknown, unknown> = Effect.void): WordCase => ({
      send: (text) => handle.send(text),
      during,
      settle: Effect.fnUntraced(function* () {
        answering.release();
        yield* quiet(world, threadId);
        resting.delete(threadId);
        yield* woken;
        yield* quiet(world, threadId);
      }),
      heard: () => Effect.sync(() => JSON.stringify(world.requests.at(-1) ?? [])),
    });
    world.answers.push({ text: 'Working.', held: answering }, { text: 'Read them.' }, { text: 'Read the rest.' });
    if (state === 'starting') return wordCase((press) => press);
    yield* started(handle, 'Begin.');
    yield* answering.reached;
    switch (state) {
      case 'running':
        return wordCase((press) => press);
      case 'ending':
        return wordCase((press) =>
          Effect.asVoid(Effect.all([Effect.sync(() => answering.release()), press], { concurrency: 'unbounded' })),
        );
      case 'stopping':
        return wordCase((press) => Effect.asVoid(Effect.all([handle.stop(), press], { concurrency: 'unbounded' })));
      case 'archived':
        return wordCase(
          (press) =>
            Effect.asVoid(
              Effect.all(
                [
                  Effect.andThen(
                    Effect.sync(() => resting.add(threadId)),
                    handle.stop(),
                  ),
                  press,
                ],
                { concurrency: 'unbounded' },
              ),
            ),
          handle.send('CHARLIE wakes the thread'),
        );
    }
  }),
});
