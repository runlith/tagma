import { Effect, type Scope, Semaphore } from 'effect';
import type { CommandFailure, Method, Session } from './session.js';

export type Domain = 'Page' | 'Network' | 'Log' | 'DOM' | 'Accessibility' | 'Runtime' | 'Overlay' | 'CSS' | 'Target' | 'Fetch';

export interface Domains {
  enable(domain: Domain, child?: string): Effect.Effect<void, CommandFailure, Scope.Scope>;
  readonly held: (domain: Domain, child?: string) => boolean;
}

const RELEASE_WAIT = '5 seconds';

const keyOf = (domain: Domain, child: string | undefined): string => `${child ?? ''}/${domain}`;

export const shareDomains = Effect.fnUntraced(function* (session: Session) {
  const counts = new Map<string, number>();
  const lock = yield* Semaphore.make(1);

  const acquire = (domain: Domain, child: string | undefined) =>
    lock.withPermits(1)(
      Effect.suspend(() => {
        const key = keyOf(domain, child);
        const count = counts.get(key) ?? 0;
        if (count > 0) return Effect.sync(() => counts.set(key, count + 1));
        return Effect.as(session.send(`${domain}.enable` as Method, undefined, child), undefined).pipe(
          Effect.tap(() => Effect.sync(() => counts.set(key, 1))),
        );
      }),
    );

  const release = (domain: Domain, child: string | undefined) =>
    lock.withPermits(1)(
      Effect.suspend(() => {
        const key = keyOf(domain, child);
        const count = counts.get(key) ?? 0;
        if (count > 1) return Effect.sync(() => counts.set(key, count - 1));
        counts.delete(key);
        return session
          .send(`${domain}.disable` as Method, undefined, child)
          .pipe(
            Effect.timeoutOption(RELEASE_WAIT),
            Effect.asVoid,
            Effect.catchTags({ SessionEnded: () => Effect.void, CommandRefused: () => Effect.void }),
          );
      }),
    );

  return {
    enable: (domain, child) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.andThen(
          restore(acquire(domain, child)),
          Effect.addFinalizer(() => Effect.orDie(release(domain, child))),
        ),
      ),
    held: (domain, child) => (counts.get(keyOf(domain, child)) ?? 0) > 0,
  } satisfies Domains;
});
