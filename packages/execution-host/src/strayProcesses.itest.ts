import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { pidStanding } from './posix/testing/processes';

it.live(
  'pid liveness answers gone only for a pid the kernel has released',
  Effect.fnUntraced(function* () {
    expect(yield* pidStanding(globalThis.process.pid)).toBe('standing');
    expect(yield* pidStanding(1)).toBe('standing');
    expect(yield* pidStanding(0)).toBe('unreadable');
    expect(yield* pidStanding(-1)).toBe('unreadable');
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(ChildProcess.make('/bin/sh', ['-c', 'exit 0'], { stdout: 'ignore', stderr: 'ignore' }));
    yield* child.exitCode;
    expect(yield* pidStanding(child.pid)).toBe('gone');
  }, Effect.provide(BunServices.layer)),
);
