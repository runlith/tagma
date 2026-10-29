import { Clock, Duration, Effect, Option } from 'effect';
import type { Session } from './session.js';

export type ProbeOptions = {
  readonly every: Duration.Input;
  readonly threshold: Duration.Input;
  readonly paused: () => boolean;
  readonly factor?: () => number;
  readonly child?: string;
};

export const watchResponsive = Effect.fnUntraced(function* (
  session: Session,
  options: ProbeOptions,
  report: (responsive: boolean) => Effect.Effect<void>,
) {
  const clock = yield* Clock.Clock;
  const threshold = Duration.toMillis(options.threshold);
  const expiry = Effect.fnUntraced(function* () {
    let previous = clock.monotonicTimeNanosUnsafe();
    let elapsed = 0;
    while (elapsed < threshold) {
      yield* Effect.sleep(options.every);
      const now = clock.monotonicTimeNanosUnsafe();
      if (!options.paused()) elapsed += Number(now - previous) / 1_000_000 / (options.factor?.() ?? 1);
      previous = now;
    }
  });
  let silent = false;
  for (;;) {
    yield* Effect.sleep(options.every);
    if (options.paused()) continue;
    const answered = yield* Effect.raceFirst(
      session
        .send('Runtime.evaluate', { expression: '0', returnByValue: true }, options.child)
        .pipe(Effect.result, Effect.map(Option.some)),
      expiry().pipe(Effect.as(Option.none())),
    );
    if (Option.isSome(answered) && answered.value._tag === 'Failure' && answered.value.failure._tag === 'SessionEnded') return;
    const responsive = Option.isSome(answered) || options.paused();
    if (responsive === !silent) continue;
    silent = !responsive;
    yield* report(responsive);
  }
});
