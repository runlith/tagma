import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Layer } from 'effect';
import { WHISPER_ABSENCE_PART } from '../installation/contract/wire/layout.js';
import { carriedEngine, engineLayout } from './engine.js';

const tree = realpathSync(mkdtempSync('/tmp/tagma-engine-'));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const world = Layer.mergeAll(host, BunChildProcessSpawner.layer.pipe(Layer.provide(host)));

it.live('a closure whose engine toolchain is missing carries the absence and its reason instead of refusing', () =>
  Effect.gen(function* () {
    const packages = join(tree, 'packages');
    mkdirSync(join(packages, 'speech-whisper', 'scripts'), { recursive: true });
    writeFileSync(
      join(packages, 'speech-whisper', 'scripts', 'build.ts'),
      "console.log('[speech-whisper] cmake is not installed');\nprocess.exit(3);\n",
    );
    const root = join(tree, 'closure');
    const outcome = yield* carriedEngine(process.execPath, packages, root, null).pipe(Effect.provide(world));
    const mac = process.platform === 'darwin';
    const reason = mac ? 'cmake is not installed' : outcome._tag === 'absent' ? outcome.reason : '';
    expect([outcome, readFileSync(join(root, WHISPER_ABSENCE_PART), 'utf8'), engineLayout(outcome)]).toEqual([
      { _tag: 'absent', reason },
      reason,
      [['server', WHISPER_ABSENCE_PART]],
    ]);
    if (mac) expect(readdirSync(join(packages, 'speech-whisper/native/.build'))).toEqual([]);
  }),
);
