import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';

it.live('a missing parsing worker fails every waiting read and a later read starts a recovered worker', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'ndjson-worker-'))),
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    );
    const { owner, worker } = yield* Effect.promise(async () => {
      const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'offLoop.ts')], target: 'bun' });
      const worker = await Bun.build({ entrypoints: [join(import.meta.dir, 'envelope.worker.ts')], target: 'bun' });
      if (!built.success || !worker.success) throw new Error([...built.logs, ...worker.logs].join('\n'));
      const entry = join(root, 'offLoop.js');
      await writeFile(entry, await built.outputs[0]!.text());
      const owner: typeof import('./offLoop') = await import(pathToFileURL(entry).href);
      return { owner, worker: await worker.outputs[0]!.text() };
    });
    const bytes = () => new TextEncoder().encode('{"method":"ready"}').buffer;
    const failed = yield* Effect.all([Effect.flip(owner.parseOffLoop(bytes())), Effect.flip(owner.parseOffLoop(bytes()))], {
      concurrency: 2,
    });
    for (const answer of failed) {
      expect(answer).toMatchObject({ _tag: 'WorkerUnavailable', worker: 'line parsing worker' });
    }
    yield* Effect.promise(() => writeFile(join(root, 'envelope.worker.ts'), worker));
    expect(yield* owner.parseOffLoop(bytes())).toEqual({ _tag: 'Notification', method: 'ready' });
  }),
);
