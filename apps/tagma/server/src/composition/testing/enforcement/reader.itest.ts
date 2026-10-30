import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { digestOf } from '@runlith/executions/hostArtifacts';
import { makeDoorWorld } from '../doorFixture.js';
import { makeThreadDoors } from '../threadDoors.js';
import { suiteGit } from '../suiteGit.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { CheckAnswer } from '../../../enforcement/contract/wire/enforcement.js';

it.live('a native thread reads the installed builtin revision after its checkout HEAD advances', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const checkout = yield* files.makeTempDirectoryScoped({ prefix: 'installed-reader-' });
    yield* suiteGit(checkout, 'init', '-q', '-b', 'main');
    yield* files.writeFileString(join(checkout, 'version.ts'), 'export const version = 1;\n');
    yield* suiteGit(checkout, 'add', 'version.ts');
    yield* suiteGit(checkout, 'commit', '-qm', 'installed reader');
    const revision = yield* suiteGit(checkout, 'rev-parse', 'HEAD');
    const world = yield* makeDoorWorld({
      installation: {
        version: 1,
        identity: { build: `${revision} 20261030T000000000Z`, digest: digestOf(new Uint8Array([1])) },
        origin: { checkout },
        platform: { os: process.platform, arch: process.arch },
        parts: [{ role: 'server', path: 'bin/server/http.js', kind: 'file', bytes: 1, digest: digestOf(new Uint8Array([2])) }],
      },
    });
    const project = yield* world.stealthProject(checkout);
    yield* Context.get(world.runtime.workspace, Coverage).cover(project);
    const created = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${project}`);
    expect(created.status).toBe(200);
    const thread = (created.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
    const doors = makeThreadDoors(world, project, ['check_rules']);
    const caller = yield* doors.doorsFor(thread.id, thread.ownerId);
    expect(caller.root).toBe(yield* files.realPath(checkout));
    yield* files.writeFileString(join(checkout, 'version.ts'), 'export const version = 2;\n');
    yield* suiteGit(checkout, 'add', 'version.ts');
    yield* suiteGit(checkout, 'commit', '-qm', 'new builtin implementation');
    const head = yield* suiteGit(checkout, 'rev-parse', 'HEAD');
    expect(head).not.toBe(revision);

    const checked = yield* doors.atNative('check_rules', { over: 'all', limit: 1 }, caller);
    if (checked.class !== 'answer') return yield* Effect.die(new Error(`check_rules refused: ${checked.code}`));
    const answer = checked.value as CheckAnswer;
    expect(answer.head).toBe(head);
    expect(answer.reader?.revision).toEqual({ head: revision, dirty: false });
    expect(world.runtime.status.source).toMatchObject({
      cut: null,
      installation: { build: `${revision} 20261030T000000000Z` },
    });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
