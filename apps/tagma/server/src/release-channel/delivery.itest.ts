import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { downloaded } from './delivery.js';

const scratch = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'release-delivery-'))),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);

const received = (chunks: readonly string[]) =>
  HttpClient.make((request) => {
    let at = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[at++];
          if (chunk === undefined) controller.close();
          else controller.enqueue(Buffer.from(chunk));
        },
      },
      { highWaterMark: 0 },
    );
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body)));
  });

const release = (size: number) => ({
  release: '0.2.0',
  archive: 'https://releases.example/archive.tar.gz',
  size,
  sha256: '0'.repeat(64),
  platform: { os: process.platform, arch: process.arch },
  changes: [],
  irreversible: false,
});

it.live('a release download refuses the first chunk beyond its declared size without writing it or publishing the archive', () =>
  Effect.gen(function* () {
    const file = join(yield* scratch, 'archive.tar.gz');
    const result = yield* Effect.result(downloaded(received(['ab', 'cde', 'f']), release(3), file, () => Effect.void));
    expect(result._tag).toBe('Failure');
    expect(existsSync(file)).toBe(false);
    expect(statSync(`${file}.part`).size).toBe(2);
  }),
);

it.live('a release download requires its exact declared size before publishing the archive and digest', () =>
  Effect.gen(function* () {
    const root = yield* scratch;
    const short = join(root, 'short.tar.gz');
    const result = yield* Effect.result(downloaded(received(['ab']), release(3), short, () => Effect.void));
    expect(result._tag).toBe('Failure');
    expect(existsSync(short)).toBe(false);
    const exact = join(root, 'exact.tar.gz');
    expect(yield* downloaded(received(['a', 'bc']), release(3), exact, () => Effect.void)).toBe(
      createHash('sha256').update('abc').digest('hex'),
    );
    expect(readFileSync(exact, 'utf8')).toBe('abc');
  }),
);
