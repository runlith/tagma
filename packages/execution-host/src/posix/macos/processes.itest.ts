import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect } from 'effect';
import { loadLibrary } from '../Library';
import type { Request } from '../processes.worker';
import { HOLDER_LIBRARY } from '../testing/holder';
import { processReader } from './processes';

const Platform = globalThis.Worker;

it.live('a worker that ends without an error mid-read fails that read typed, and the next read is answered by a new worker', () =>
  Effect.gen(function* () {
    let started = 0;
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        globalThis.Worker = class extends Platform {
          private readonly ends = started++ === 0;

          override postMessage(message: Request, options?: Transferable[] | StructuredSerializeOptions): void {
            if (this.ends && message._tag === 'Ask') return this.terminate();
            if (Array.isArray(options)) super.postMessage(message, options);
            else super.postMessage(message, options);
          }
        };
      }),
      () =>
        Effect.sync(() => {
          globalThis.Worker = Platform;
        }),
    );
    const reader = yield* processReader(yield* loadLibrary(HOLDER_LIBRARY));
    expect((yield* Effect.flip(reader.facts([process.pid])))._tag).toBe('ProcessesUnreadable');
    expect((yield* reader.facts([process.pid])).processes.map((one) => one.pid)).toEqual([process.pid]);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
