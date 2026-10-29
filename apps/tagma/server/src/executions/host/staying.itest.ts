import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Deferred, Effect, Fiber, FileSystem, Ref } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { ClaimHolding } from '../contract/service/host.js';
import { hostsStaying } from './staying.js';

const root = mkdtempSync(join(tmpdir(), 'hosts-staying-'));
const store = join(root, 'tagma.sqlite');
const state = join(root, 'executions', 'environment');
mkdirSync(state, { recursive: true });
writeFileSync(join(state, 'writer.lock'), '');

afterAll(() => rmSync(root, { recursive: true, force: true }));

const held: ClaimHolding = { _tag: 'Holders', pids: [4242] };

it.live('a live host claim keeps the wait pending until its holder lets go', () =>
  Effect.gen(function* () {
    const holding = yield* Ref.make<ClaimHolding>(held);
    const read = yield* Deferred.make<void>();
    const settled = yield* Deferred.make<void>();
    const reading = { of: () => Effect.andThen(Deferred.succeed(read, undefined), Ref.get(holding)) };
    const waiting = yield* Effect.forkChild(
      Effect.flatMap(FileSystem.FileSystem, (files) => hostsStaying(reading, files, store)).pipe(
        Effect.provide(BunFileSystem.layer),
        Effect.tap(() => Deferred.succeed(settled, undefined)),
      ),
    );
    yield* Deferred.await(read);
    expect(yield* Deferred.isDone(settled)).toBe(false);
    yield* Ref.set(holding, { _tag: 'Holders', pids: [] });
    expect(yield* Fiber.join(waiting)).toEqual([]);
  }),
);

it.live('a claim whose holders cannot be read is reported staying with the reason, not waited on', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const staying = yield* hostsStaying({ of: () => Effect.succeed({ _tag: 'Unread', detail: 'no reader here' }) }, files, store);
    expect(staying).toEqual([{ state, claim: { _tag: 'Unmeasured', detail: 'no reader here' } }]);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
