import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Layer } from 'effect';
import { targetTrouble } from './target.js';

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

it.live('a cut for a target whose Rust target is not installed refuses with the command that installs it', () =>
  Effect.gen(function* () {
    const bin = yield* Effect.acquireRelease(
      Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'tagma-target-')))),
      (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
    );
    writeFileSync(join(bin, 'rustup'), '#!/bin/sh\necho aarch64-apple-darwin\n');
    chmodSync(join(bin, 'rustup'), 0o755);
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const before = process.env.PATH;
        process.env.PATH = `${bin}:${before ?? ''}`;
        return before;
      }),
      (before) => Effect.sync(() => void (process.env.PATH = before)),
    );
    const trouble = yield* targetTrouble({ os: 'darwin', arch: 'x64' }, bin).pipe(Effect.provide(spawning));
    expect(trouble?.unblock[0]?.startsWith('rustup target add x86_64-apple-darwin')).toBe(true);
  }),
);
