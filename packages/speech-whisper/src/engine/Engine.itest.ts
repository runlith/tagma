import { afterAll, beforeAll, describe, expect } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { it } from '@runlith/effect-test';
import { Context, Effect, Exit, Fiber, Layer, Option, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Engine, type EngineOptions } from './Engine.ts';

let root = '';
let fake = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'speech-whisper-engine-'));
  fake = join(root, 'engine');
  writeFileSync(fake, `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, '..', 'testing', 'fakeEngine.ts')}"\n`);
  chmodSync(fake, 0o755);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const spawner = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

const open = Effect.fnUntraced(function* (options?: EngineOptions, binary = fake) {
  const context = yield* Layer.build(
    Engine.layer({ engine: binary, silero: join(root, 'silero.bin') }, options).pipe(Layer.provide(spawner)),
  );
  return Context.get(context, Engine);
});

const small = { id: 'small', path: '/models/small.bin' };
const large = { id: 'large', path: '/models/large.bin' };
const crash = -1;
const endless = -2;

const clip = (marker: number, ms = 100): Int16Array => {
  const pcm = new Int16Array(16 * ms);
  pcm[0] = marker;
  return pcm;
};

const textOf = (transcript: { readonly segments: ReadonlyArray<{ readonly text: string }> }) =>
  transcript.segments.map((segment) => segment.text).join('');

const pending = <A, E>(fiber: Fiber.Fiber<A, E>) => Effect.map(Effect.timeoutOption(Fiber.await(fiber), 0), Option.isNone);

describe('Engine', () => {
  it.live('serves the clips of every caller one by one in the order they were queued', () =>
    Effect.gen(function* () {
      const engine = yield* open({ queueMs: 3_000 });
      const order: string[] = [];
      const fibers = [];
      for (const marker of [1, 2, 3]) {
        const work = Effect.tap(engine.transcribe(small, clip(marker), undefined), (done) => Effect.sync(() => order.push(textOf(done))));
        fibers.push(yield* Effect.forkChild(work));
        yield* Effect.yieldNow;
      }
      yield* Fiber.joinAll(fibers);
      expect(order).toEqual(['clip 1', 'clip 2', 'clip 3']);
    }),
  );

  it.live('a cancelled clip leaves the engine to the next one, and a second model is refused while the first works', () =>
    Effect.gen(function* () {
      const engine = yield* open({ queueMs: 3_000 });
      yield* engine.transcribe(small, clip(5), undefined);
      const stuck = yield* Effect.forkChild(engine.transcribe(small, clip(endless), undefined));
      const next = yield* Effect.forkChild(engine.transcribe(small, clip(7), undefined));
      yield* Effect.sleep(50);
      const other = yield* Effect.exit(engine.transcribe(large, clip(8), undefined));
      yield* Fiber.interrupt(stuck);
      expect(textOf(yield* Fiber.join(next))).toBe('clip 7');
      expect(Exit.isFailure(other) && Exit.findErrorOption(other)).toMatchObject(Option.some({ _tag: 'ModelBusy' }));
    }),
  );

  it.live('a clip past the audio budget of the queue is refused', () =>
    Effect.gen(function* () {
      const engine = yield* open({ queueMs: 3_000 });
      const stuck = yield* Effect.forkChild(engine.transcribe(small, clip(endless, 2_000), undefined));
      yield* Effect.yieldNow;
      const refused = yield* Effect.flip(engine.transcribe(small, clip(9, 1_500), undefined));
      yield* Fiber.interrupt(stuck);
      expect(refused._tag).toBe('QueueFull');
    }),
  );

  it.live('cancelling a queued clip frees its share of the budget at once and keeps the order of the rest', () =>
    Effect.gen(function* () {
      const engine = yield* open({ queueMs: 3_000 });
      yield* engine.transcribe(small, clip(5), undefined);
      const stuck = yield* Effect.forkChild(engine.transcribe(small, clip(endless, 1_000), undefined));
      const cancelled = yield* Effect.forkChild(engine.transcribe(small, clip(6, 1_500), undefined));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(cancelled);
      const admitted = yield* Effect.forkChild(engine.transcribe(small, clip(7, 1_500), undefined));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(stuck);
      expect(textOf(yield* Fiber.join(admitted))).toBe('clip 7');
    }),
  );

  it.live('a crash fails the clip and every detector stream, and the next clip starts the engine again', () =>
    Effect.gen(function* () {
      const engine = yield* open({ queueMs: 3_000 });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const detection = yield* engine.detect;
          const heard = yield* Effect.forkChild(Effect.exit(Stream.runDrain(detection.probs)));
          const crashed = yield* Effect.flip(engine.transcribe(small, clip(crash), undefined));
          const stream = yield* Fiber.join(heard);
          const again = yield* engine.transcribe(small, clip(9), undefined);
          expect(crashed._tag).toBe('EngineCrashed');
          expect(Exit.isFailure(stream) && Exit.findErrorOption(stream)).toMatchObject(Option.some({ _tag: 'EngineCrashed' }));
          expect(textOf(again)).toBe('clip 9');
        }),
      );
    }),
  );

  it.live('the detector answers while the model loads and while a clip is recognized', () =>
    Effect.gen(function* () {
      const engine = yield* open({ queueMs: 3_000 });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const detection = yield* engine.detect;
          const loading = yield* Effect.forkChild(engine.transcribe(small, clip(4), undefined));
          yield* detection.push(new Int16Array(detection.window));
          const first = yield* Stream.runHead(detection.probs);
          const duringLoad = yield* pending(loading);
          yield* Fiber.join(loading);
          const recognizing = yield* Effect.forkChild(engine.transcribe(small, clip(endless), undefined));
          yield* Effect.sleep(50);
          yield* detection.push(new Int16Array(detection.window));
          const second = yield* Stream.runHead(detection.probs);
          const duringInference = yield* pending(recognizing);
          yield* Fiber.interrupt(recognizing);
          expect(first).toMatchObject(Option.some({ at: 0, samples: 512 }));
          expect(second).toMatchObject(Option.some({ at: 512, samples: 512 }));
          expect(duringLoad).toBe(true);
          expect(duringInference).toBe(true);
        }),
      );
    }),
  );

  it.live('an engine compiling its GPU shaders on a cold start is waited for past ten seconds', () => {
    const cold = join(root, 'cold');
    const started = join(root, 'cold.started');
    const warm = join(root, 'cold.warm');
    writeFileSync(cold, `#!/bin/sh\ntouch "${started}"\nwhile [ ! -e "${warm}" ]; do sleep 0.02; done\nexec "${fake}"\n`);
    chmodSync(cold, 0o755);
    return Effect.gen(function* () {
      const onEngine = yield* open({}, cold);
      const detecting = yield* Effect.forkChild(Effect.scoped(Effect.as(onEngine.detect, 'ready' as const)));
      yield* Effect.promise(async () => {
        while (!existsSync(started)) await Bun.sleep(10);
        await Bun.sleep(50);
      });
      yield* TestClock.adjust('11 seconds');
      writeFileSync(warm, '');
      expect(yield* Fiber.await(detecting)).toEqual(Exit.succeed('ready'));
    }).pipe(Effect.provide(TestClock.layer()));
  });
});
