import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { workerLink } from './worker.js';

type ReadAsk = { readonly id: number; readonly kind: 'read'; readonly path: string };
type ReadAnswer = { readonly id: number; readonly kind: 'read' } & ({ readonly text: string } | { readonly failure: string });
type ReadyNote = { readonly id: number; readonly kind: 'ready' };

it.live('a joined request keeps its resources through interruption and settles failure only after the worker closes', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'worker-source-'))),
      (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
    );
    const path = join(root, 'prefix');
    writeFileSync(path, 'retained prefix');
    let ready = yield* Deferred.make<void>();
    const read = yield* Deferred.make<ReadAnswer>();
    let closed = false;
    const script = `
      let held;
      self.addEventListener('message', async ({ data }) => {
        if (data.kind === 'read') {
          held = data;
          self.postMessage({ id: data.id, kind: 'ready' });
          return;
        }
        const ask = held;
        held = undefined;
        try {
          self.postMessage({ id: ask.id, kind: 'read', text: await Bun.file(ask.path).text() });
        } catch (cause) {
          self.postMessage({ id: ask.id, kind: 'read', failure: String(cause) });
        }
      });
    `;
    const link = workerLink<ReadAsk, ReadAnswer, ReadyNote>(
      'source reader',
      () => {
        const worker = new Worker(`data:text/javascript,${encodeURIComponent(script)}`, { type: 'module' });
        worker.addEventListener('close', () => {
          closed = true;
        });
        worker.addEventListener('message', (event: MessageEvent<ReadAnswer | ReadyNote>) => {
          if (event.data.kind === 'read') Deferred.doneUnsafe(read, Effect.succeed(event.data));
        });
        return worker;
      },
      (message): message is ReadyNote => message.kind === 'ready',
    );
    yield* Effect.addFinalizer(() => Effect.sync(() => link.close('test ended')));
    const ask = () =>
      link.run(
        (id) => ({ id, kind: 'read', path }),
        [],
        () => {
          Deferred.doneUnsafe(ready, Effect.void);
        },
      );
    const using = yield* Effect.forkScoped(ask().pipe(Effect.ensuring(Effect.sync(() => rmSync(path)))));
    yield* Deferred.await(ready);
    using.interruptUnsafe();
    link.tell({ kind: 'release' });
    expect(yield* Deferred.await(read)).toMatchObject({ kind: 'read', text: 'retained prefix' });
    yield* Fiber.await(using);
    ready = yield* Deferred.make<void>();
    const ending = yield* Effect.forkScoped(Effect.result(ask()));
    yield* Deferred.await(ready);
    link.close('reader ended');
    const outcome = yield* Fiber.join(ending);
    expect(outcome._tag === 'Failure' ? outcome.failure : outcome.success).toMatchObject({ _tag: 'WorkerUnavailable' });
    expect(closed).toBe(true);
  }),
);
