import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'bun:test';
import * as BunWorker from '@effect/platform-bun/BunWorker';
import { it } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Exit, Fiber, Option } from 'effect';
import { prepareWorker } from '@runlith/held/PreparedWorker';
import { WorkerPlatform } from 'effect/workers/Worker';

const scratch = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), prefix))),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  );

it.live('preparation preserves the child and queued replies until adoption, and both owners reap it', () =>
  Effect.gen(function* () {
    const root = yield* scratch('prepared-worker-');
    const entry = join(root, 'prepared.ts');
    writeFileSync(
      entry,
      `
const identity = crypto.randomUUID();
self.addEventListener('message', ({ data }) => {
  if (data[0] === 1) process.exit(0);
  self.postMessage([1, { identity, value: data[1] }]);
});
self.postMessage([0]);
`,
    );
    type Answer = { readonly identity: string; readonly value: number };
    let closed = Promise.resolve();
    const platform = BunWorker.layer(() => {
      const child = new Worker(entry, { type: 'module' });
      closed = new Promise<void>((resolve) => child.addEventListener('close', () => resolve(), { once: true }));
      return child;
    });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const worker = yield* prepareWorker(yield* (yield* WorkerPlatform).spawn<Answer, number>(0));
        yield* worker.send(1);
        const complete = yield* Deferred.make<readonly Answer[]>();
        const answers: Answer[] = [];
        yield* Effect.forkScoped(
          worker.run(
            (answer) =>
              Effect.sync(() => {
                answers.push(answer);
                if (answers.length === 2) Deferred.doneUnsafe(complete, Effect.succeed(answers));
              }),
            { onSpawn: Effect.orDie(worker.send(2)) },
          ),
        );
        const received = yield* Deferred.await(complete);
        expect(received.map((answer) => answer.value)).toEqual([1, 2]);
        expect(received[0]?.identity).toBe(received[1]?.identity);
      }),
    ).pipe(Effect.provide(platform));
    yield* Effect.promise(() => closed);
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* prepareWorker(yield* (yield* WorkerPlatform).spawn<Answer, number>(0));
      }),
    ).pipe(Effect.provide(platform));
    yield* Effect.promise(() => closed);
  }),
);

it.live('a worker closing without an error ends its runner with a typed failure and releases pending work', () =>
  Effect.gen(function* () {
    const root = yield* scratch('effect-worker-close-');
    const entry = join(root, 'closing.ts');
    writeFileSync(entry, 'self.addEventListener("message", () => process.exit(0)); self.postMessage([0]);\n');
    const exit = yield* Effect.scoped(
      Effect.gen(function* () {
        const platform = yield* WorkerPlatform;
        const worker = yield* platform.spawn<never, string>(0);
        const run = yield* Effect.forkScoped(worker.run(() => Effect.void));
        yield* worker.send('close');
        return yield* Fiber.await(run);
      }),
    ).pipe(Effect.provide(BunWorker.layer(() => new Worker(entry, { type: 'module' }))));
    const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
    expect(failure).toMatchObject({ _tag: 'Some', value: { _tag: 'WorkerError', reason: { message: 'The worker closed' } } });
  }),
);
