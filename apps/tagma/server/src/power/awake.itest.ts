import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem, Layer, Stream } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { keepAwake } from './keys.js';
import { graphFixture } from '../composition/testing/graphFixture.js';
import { Settings } from '../settings/contract/service/values.js';
import { AwakePolicy } from './contract/service/awake.js';
import { awakePolicyLayer } from './awake.js';
import { alive, pidFrom, until } from './testing/waiting.js';

const world = graphFixture();
const graph = Layer.effectContext(
  Effect.map(
    Effect.acquireRelease(world.openEffect(), () => Effect.orDie(world.releaseEffect)),
    (demo) => demo.context,
  ),
);
const write = (mode: string) => Effect.flatMap(Settings, (settings) => settings.write({ scope: 'user', key: keepAwake.id, value: mode }));

it.live('awake modes move the real helper and publish their latest state, and closing the owner releases a standing hold', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const pidFile = join(yield* files.makeTempDirectoryScoped(), 'helper.pid');
    const held = yield* Effect.scoped(
      Effect.gen(function* () {
        const policy = yield* AwakePolicy;
        const slow = yield* Stream.toPull(policy.changes);
        expect((yield* slow)[0]?.state._tag).toBe('released');
        yield* write('always');
        yield* until(() => policy.state().mode === 'always');
        expect(policy.state().state._tag).toBe('holding');
        const first = yield* pidFrom(pidFile);
        expect(alive(first)).toBe(true);
        yield* write('off');
        yield* until(() => policy.state().mode === 'off');
        policy.working(1);
        expect(policy.state().state._tag).toBe('released');
        yield* until(() => !alive(first));
        yield* files.remove(pidFile, { force: true });
        yield* write('while-working');
        yield* until(() => policy.state().mode === 'while-working');
        expect(policy.state().state._tag).toBe('holding');
        const middle = yield* pidFrom(pidFile);
        policy.working(0);
        yield* until(() => !alive(middle));
        expect(yield* slow).toEqual([policy.state()]);
        expect(yield* Stream.runCollect(Stream.take(policy.changes, 1))).toEqual([policy.state()]);
        expect(policy.state().state._tag).toBe('released');
        yield* files.remove(pidFile, { force: true });
        yield* write('always');
        yield* until(() => policy.state().mode === 'always');
        const final = yield* pidFrom(pidFile);
        expect(alive(final)).toBe(true);
        return final;
      }).pipe(
        Effect.provide(
          awakePolicyLayer({
            _tag: 'helper',
            program: '/bin/sh',
            args: ['-c', `echo $$ > ${pidFile}; exec sleep 30`],
            limit: 'idle sleep only',
          }).pipe(Layer.provideMerge(graph)),
        ),
      ),
    );
    yield* until(() => !alive(held));
    expect(alive(held)).toBe(false);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
