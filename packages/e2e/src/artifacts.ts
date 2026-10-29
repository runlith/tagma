import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { reportPath } from '@runlith/testbed/fixture';
import { Cause, Effect, Exit, type Scope } from 'effect';

export type FailureArtifact = (directory: string) => Promise<void>;
type Recording = { readonly directory: string; readonly failures: Set<FailureArtifact> };
const recording = new AsyncLocalStorage<Recording>();
const pending = new Set<FailureArtifact>();

export const onFailure = (write: FailureArtifact): (() => void) => {
  const callbacks = recording.getStore()?.failures ?? pending;
  callbacks.add(write);
  return () => callbacks.delete(write);
};

export const artifactDirectory = (file: string, name: string): string => {
  const report = reportPath();
  if (report === undefined) throw new Error('browser fixtures must run through testbed');
  const safe = `${name.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 100)}-${createHash('sha256').update(name).digest('hex').slice(0, 8)}`;
  const directory = join(
    dirname(report),
    basename(report, '.jsonl'),
    `${basename(file)}-${createHash('sha256').update(file).digest('hex').slice(0, 8)}`,
    safe,
  );
  mkdirSync(directory, { recursive: true });
  return directory;
};

export const record = <A>(directory: string, work: () => Promise<A>): Promise<A> =>
  recording.run({ directory, failures: new Set(pending) }, work);

export const captureFailure = async (): Promise<void> => {
  const active = recording.getStore();
  if (active === undefined) throw new Error('no e2e artifact recording stands');
  const results = await Promise.allSettled([...active.failures].map((write) => write(active.directory)));
  const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length > 0) throw new AggregateError(failures, `failure artifacts could not all be written to ${active.directory}`);
};

export const recorded = Effect.fn('e2e.recorded')(function* <A, E>(
  name: string,
  work: (directory: string) => Effect.Effect<A, E, Scope.Scope>,
) {
  const directory = artifactDirectory(Bun.main, name);
  return yield* Effect.callback<A>((resume, signal) => {
    const running = record(directory, () =>
      Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const exit = yield* Effect.exit(work(directory));
            if (Exit.isFailure(exit)) {
              const captured = yield* Effect.exit(Effect.tryPromise(() => captureFailure()));
              const errors = [Cause.pretty(exit.cause), ...(Exit.isFailure(captured) ? [Cause.pretty(captured.cause)] : [])];
              return yield* Effect.die(new Error(`${errors.join('\n')}\nArtifacts: ${directory}`));
            }
            return exit.value;
          }),
        ),
        { signal },
      ),
    );
    running.then(
      (exit) => resume(exit),
      (cause) => resume(Effect.die(cause)),
    );
    return Effect.promise(() => running.then(() => undefined));
  });
});
