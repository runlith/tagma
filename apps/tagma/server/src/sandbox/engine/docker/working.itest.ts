import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { WorkingStat, workingAt, workingOf } from '@runlith/files/working';
import { fixtureHome } from '../../../platform/testing/roots.js';
import { askFrame, GuestFrames, type GuestFrame } from './wire.js';

it.live('guest working inputs use the same witness as the host and preserve ctime across the wire', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(fixtureHome(), 'guest-working-'))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    );
    const file = join(root, 'file');
    const child = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn(
          [process.execPath, new URL('./helper.ts', import.meta.url).pathname, 'serve', JSON.stringify({ dir: root, id: 'working' })],
          { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
        ),
      ),
      (child) =>
        Effect.promise(async () => {
          child.stdin.end();
          await child.exited;
        }),
    );
    const reader = yield* Effect.acquireRelease(
      Effect.sync(() => child.stdout.getReader()),
      (reader) => Effect.promise(() => reader.cancel()).pipe(Effect.ensuring(Effect.sync(() => reader.releaseLock()))),
    );
    const errors = new Response(child.stderr).text();
    const frames = new GuestFrames();
    let id = 0;
    const ask = async (path: string): Promise<GuestFrame> => {
      child.stdin.write(askFrame(++id, { op: 'working', path }, undefined));
      child.stdin.flush();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`guest ended: ${await errors}`);
        const [frame] = frames.read(chunk.value);
        if (frame !== undefined) return frame;
      }
    };
    yield* Effect.promise(() => writeFile(file, 'before'));
    const first = yield* Effect.promise(() => ask(file));
    expect(first.ok).toBe(true);
    const info = yield* Schema.decodeUnknownEffect(WorkingStat)(first.value.working);
    const future = info.changedAt + 3000;
    expect(workingOf(info, future)).toEqual(yield* workingAt(file, future));
    expect(workingOf(info, info.changedAt)).toMatchObject({ kind: 'file', size: 6, key: null });
    const before = yield* Effect.promise(() => stat(file));
    yield* Effect.promise(() => writeFile(file, 'after!'));
    yield* Effect.promise(() => utimes(file, before.atime, before.mtime));
    const second = yield* Effect.promise(() => ask(file));
    const next = yield* Schema.decodeUnknownEffect(WorkingStat)(second.value.working);
    const later = Math.max(info.changedAt, next.changedAt) + 3000;
    expect(workingOf(next, later)).not.toEqual(workingOf(info, later));
    expect(workingOf(next, later)).toEqual(yield* workingAt(file, later));
    const absent = yield* Effect.promise(() => ask(join(root, 'absent')));
    expect(absent.ok).toBe(false);
    expect(absent.value.error).toMatchObject({ code: 'ENOENT' });
  }),
);
