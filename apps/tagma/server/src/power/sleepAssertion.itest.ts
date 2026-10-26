import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Effect, FiberSet, FileSystem } from 'effect';
import { CAFFEINATE, idleSleepFacility, SleepAssertion, type SleepFacility } from './sleepAssertion.js';
import { alive, pidFrom, until } from './testing/waiting.js';

const longLived = (pidFile: string) => ({
  _tag: 'helper' as const,
  program: '/bin/sh',
  args: ['-c', `echo $$ > ${pidFile}; exec sleep 30`],
  limit: 'idle sleep only',
});

const over = Effect.fnUntraced(function* (facility: SleepFacility) {
  const run = yield* FiberSet.runtime(yield* FiberSet.make())<never>();
  const built = new SleepAssertion(facility, (work) => {
    run(work);
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => built.release()));
  return built;
});

const pidPath = Effect.fnUntraced(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const pidFile = join('/tmp', `tagma-sleep-${randomUUID()}.pid`);
  yield* Effect.addFinalizer(() => Effect.orDie(fileSystem.remove(pidFile, { force: true })));
  return pidFile;
});

it.live('the macOS facility prevents idle system sleep and ties the helper to the process it names', () =>
  Effect.sync(() => {
    const facility = idleSleepFacility('darwin', 4242);

    expect(facility).toMatchObject({ _tag: 'helper', program: CAFFEINATE, args: ['-i', '-w', '4242'] });
  }),
);

it.live('a platform with no facility reports unavailable and never claims a holding', () =>
  Effect.gen(function* () {
    const facility = idleSleepFacility('linux', 4242);
    expect(facility._tag).toBe('none');

    const assertion = yield* over(facility);
    const states: string[] = [];
    assertion.onChange((state) => states.push(state._tag));

    expect(assertion.acquire()._tag).toBe('unavailable');
    expect(assertion.state._tag).toBe('unavailable');
    expect(states).toEqual([]);
  }),
);

it.live('an acquired assertion is a live child, and releasing it leaves no process behind', () =>
  Effect.gen(function* () {
    const pidFile = yield* pidPath();
    const assertion = yield* over(longLived(pidFile));
    expect(assertion.acquire()._tag).toBe('holding');

    const pid = yield* pidFrom(pidFile);
    expect(alive(pid)).toBe(true);

    expect(assertion.release()._tag).toBe('released');
    yield* until(() => !alive(pid));
    expect(alive(pid)).toBe(false);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('a helper that leaves on its own reports a failure, and the next acquire tries again', () =>
  Effect.gen(function* () {
    const assertion = yield* over({ _tag: 'helper', program: '/bin/sh', args: ['-c', 'exit 3'], limit: 'idle sleep only' });
    const states: string[] = [];
    assertion.onChange((state) => states.push(state._tag));

    expect(assertion.acquire()._tag).toBe('holding');
    yield* until(() => assertion.state._tag === 'failed');

    const failed = assertion.state;
    expect(failed._tag).toBe('failed');
    if (failed._tag === 'failed') expect(failed.reason).toContain('exited 3');
    expect(states).toEqual(['holding', 'failed']);

    expect(assertion.acquire()._tag).toBe('holding');
  }),
);

it.live('closing the owner leaves no helper behind, whatever was held', () =>
  Effect.gen(function* () {
    const pidFile = yield* pidPath();
    const pid = yield* Effect.scoped(
      Effect.gen(function* () {
        const assertion = yield* over(longLived(pidFile));
        expect(assertion.acquire()._tag).toBe('holding');
        const held = yield* pidFrom(pidFile);
        expect(alive(held)).toBe(true);
        return held;
      }),
    );

    yield* until(() => !alive(pid));
    expect(alive(pid)).toBe(false);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
