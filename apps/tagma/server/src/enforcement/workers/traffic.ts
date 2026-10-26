import { Effect } from 'effect';
import { Turns } from './turns.js';

export const makeTraffic = () => {
  let foreground = 0;
  const waiting = new Set<() => void>();
  const turns = new Turns(1);

  return {
    run: <A, E, R>(use: Effect.Effect<A, E, R>) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          foreground += 1;
          return restore(use).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                foreground -= 1;
                if (foreground !== 0) return;
                const wake = [...waiting];
                waiting.clear();
                for (const one of wake) one();
              }),
            ),
          );
        }),
      ),

    idle: <A, E, R>(use: Effect.Effect<A, E, R>) =>
      turns.within({}, () =>
        Effect.gen(function* () {
          while (foreground > 0) {
            yield* Effect.callback<void>((resume) => {
              if (foreground === 0) return resume(Effect.void);
              const wake = () => resume(Effect.void);
              waiting.add(wake);
              return Effect.sync(() => {
                waiting.delete(wake);
              });
            });
          }
          return yield* use;
        }),
      ),
  };
};
