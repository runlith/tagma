import { describe, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { it } from '@runlith/effect-test';
import { Context, Effect, Exit, Layer, Stream } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import type { ModelArtifact } from './catalog.ts';
import { ModelStore } from './ModelStore.ts';

const chunk = 64 * 1024;
const bytes = Uint8Array.from({ length: 3 * chunk }, (_, index) => (index * 7) % 251);
const artifact: ModelArtifact = {
  id: 'tiny',
  label: 'Tiny',
  url: 'https://models.test/tiny.bin',
  size: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};

type Serving = 'stall' | 'whole' | 'short' | 'corrupt' | 'oversize';

class Host {
  serving: Serving = 'whole';
  readonly ranges: Array<string | undefined> = [];
  cancelled = 0;

  respond(range: string | undefined, signal: AbortSignal): Response {
    this.ranges.push(range);
    const from = range === undefined ? 0 : Number(/^bytes=(\d+)-$/.exec(range)?.[1]);
    const body = this.body(from);
    const host = this;
    let at = 0;
    let ended = false;
    signal.addEventListener('abort', () => {
      if (!ended) host.cancelled += 1;
    });
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at < body.byteLength) {
          controller.enqueue(body.slice(at, at + chunk));
          at += chunk;
        } else if (host.serving !== 'stall' && host.serving !== 'oversize') {
          ended = true;
          controller.close();
        } else return new Promise<void>(() => undefined);
      },
    });
    if (from === 0) return new Response(stream, { status: 200 });
    return new Response(stream, { status: 206, headers: { 'content-range': `bytes ${from}-${bytes.byteLength - 1}/${bytes.byteLength}` } });
  }

  private body(from: number): Uint8Array {
    switch (this.serving) {
      case 'stall':
        return bytes.slice(from, from + chunk);
      case 'short':
        return bytes.slice(from, bytes.byteLength - 1);
      case 'corrupt':
        return bytes.slice(from).map((byte) => byte ^ 1);
      case 'oversize':
        return Uint8Array.from([...bytes.slice(from), 0]);
      case 'whole':
        return bytes.slice(from);
    }
  }
}

const open = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), 'speech-whisper-models-'))),
    (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
  );
  const host = new Host();
  const client = HttpClient.make((request, _url, signal) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, host.respond(request.headers['range'], signal))),
  );
  const context = yield* Layer.build(
    ModelStore.layer(root, [artifact]).pipe(
      Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer, Layer.succeed(HttpClient.HttpClient, client))),
    ),
  );
  return { host, store: Context.get(context, ModelStore) };
});

const installing = (store: ModelStore['Service']) => Effect.exit(Stream.runDrain(store.install(artifact.id)));
const isInstalled = (store: ModelStore['Service']) => Effect.map(Effect.exit(store.installed(artifact.id)), Exit.isSuccess);
const failureOf = <A, E extends { readonly _tag: string }>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? Exit.findErrorOption(exit).pipe((found) => (found._tag === 'Some' ? found.value._tag : 'defect')) : 'none';

describe('ModelStore', () => {
  it.live('a stopped download resumes at the bytes already on disk and installs the verified model', () =>
    Effect.gen(function* () {
      const { host, store } = yield* open;
      host.serving = 'stall';
      yield* Stream.runDrain(store.install(artifact.id).pipe(Stream.takeUntil((progress) => progress.received >= chunk)));
      host.serving = 'whole';
      const finished = yield* installing(store);
      const installed = yield* store.installed(artifact.id);
      expect(Exit.isSuccess(finished)).toBe(true);
      expect(host.ranges).toEqual([undefined, `bytes=${chunk}-`]);
      expect(host.cancelled).toBe(1);
      expect(new Uint8Array(readFileSync(installed.path))).toEqual(bytes);
    }),
  );

  it.live('a short download or a wrong hash leaves no installed model', () =>
    Effect.gen(function* () {
      const short = yield* open;
      short.host.serving = 'short';
      const shortExit = yield* installing(short.store);
      const shortInstalled = yield* isInstalled(short.store);

      const corrupt = yield* open;
      corrupt.host.serving = 'corrupt';
      const corruptExit = yield* installing(corrupt.store);
      const corruptInstalled = yield* isInstalled(corrupt.store);

      expect([failureOf(shortExit), shortInstalled]).toEqual(['DownloadFailed', false]);
      expect([failureOf(corruptExit), corruptInstalled]).toEqual(['IntegrityFailed', false]);
    }),
  );

  it.live('a host sending more than the model holds is refused and its read is closed', () =>
    Effect.gen(function* () {
      const { host, store } = yield* open;
      host.serving = 'oversize';
      const exit = yield* installing(store);
      const installed = yield* isInstalled(store);
      expect([failureOf(exit), installed, host.cancelled]).toEqual(['IntegrityFailed', false, 1]);
    }),
  );

  it.live('a download stopped before publication publishes nothing, and the next install publishes what is on disk', () =>
    Effect.gen(function* () {
      const { host, store } = yield* open;
      yield* Stream.runDrain(store.install(artifact.id).pipe(Stream.takeUntil((progress) => progress.received === artifact.size)));
      const afterStop = yield* isInstalled(store);
      const finished = yield* installing(store);
      const afterInstall = yield* isInstalled(store);
      expect([afterStop, Exit.isSuccess(finished), afterInstall]).toEqual([false, true, true]);
      expect(host.ranges).toEqual([undefined]);
    }),
  );
});
