import { type Duration, Effect, Option } from 'effect';
import type { Session } from './session.js';

export type ProbeOptions = {
  readonly every: Duration.Input;
  readonly threshold: Duration.Input;
  readonly paused: () => boolean;
  readonly child?: string;
};

export const watchResponsive = Effect.fnUntraced(function* (
  session: Session,
  options: ProbeOptions,
  report: (responsive: boolean) => Effect.Effect<void>,
) {
  let silent = false;
  for (;;) {
    yield* Effect.sleep(options.every);
    if (options.paused()) continue;
    const answered = yield* session
      .send('Runtime.evaluate', { expression: '0', returnByValue: true }, options.child)
      .pipe(Effect.result, Effect.timeoutOption(options.threshold));
    if (Option.isSome(answered) && answered.value._tag === 'Failure' && answered.value.failure._tag === 'SessionEnded') return;
    const responsive = Option.isSome(answered) || options.paused();
    if (responsive === !silent) continue;
    silent = !responsive;
    yield* report(responsive);
  }
});
