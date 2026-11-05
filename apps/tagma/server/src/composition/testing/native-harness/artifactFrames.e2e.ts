import { expect } from 'bun:test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { TIMELINE_FRAGMENT } from '../../../artifacts/contract/wire/fragment.js';
import { ARTIFACT_OPERATIONS } from '../../../artifacts/contract/wire/operations.js';
import { HostLost, Hosts } from '../../../browser/contract/service/hosts.js';
import { managedTestHost } from '../../../managed-browser/testing/host.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { makeThreadDoors } from '../threadDoors.js';

const MOTION = `<!doctype html><title>Motion</title><script type="application/json" id="tagma-timeline">{"v":1,"duration":7,"fps":30,"width":1920,"height":1080}</script><div id="stage"><div id="face" style="width:100%;height:100%"></div></div><script>window.render = (t) => { document.getElementById('face').style.background = t > 6 ? '#ff8000' : '#0080ff'; };</script>${TIMELINE_FRAGMENT}`;
const decodeFrames = Schema.decodeUnknownEffect(knownAnswer(ARTIFACT_OPERATIONS.read_artifact_frames.answer));
const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
const noExtensions = Layer.effect(
  ChildProcessSpawner.ChildProcessSpawner,
  Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    ChildProcessSpawner.make((command) =>
      spawner.spawn(
        ChildProcess.isStandardCommand(command) && command.args.includes('--remote-debugging-pipe')
          ? ChildProcess.make(
              command.command,
              [...command.args, '--disable-extensions', '--disable-component-extensions-with-background-pages'],
              command.options,
            )
          : command,
      ),
    ),
  ),
).pipe(Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(platform))));

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('native artifact frames', (it) => {
  it.effect('draws frame 209 from a Tagma thread scratch in an idle browser and reports capture host loss separately', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const project = yield* world.stealthProject();
      yield* projectLeaving(world, project);
      const created = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${project}`);
      const {
        snapshot: { thread },
      } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(created.body);
      const doors = makeThreadDoors(world, project, ['read_artifact_frames']);
      const caller = yield* doors.doorsFor(thread.id, thread.ownerId);
      const scratch = world.runtime.scratch.scope(thread.id);
      yield* files.makeDirectory(scratch.path, { recursive: true });
      const path = join(scratch.path, 'motion.html');
      yield* files.writeFileString(path, MOTION);

      let lost = false;
      const hosts = Context.getOrUndefined(world.runtime.owners, Hosts)!;
      const spawner = Context.get(yield* Layer.build(noExtensions), ChildProcessSpawner.ChildProcessSpawner);
      yield* Layer.build(
        managedTestHost(yield* world.directory('capture'), {
          spawner,
          wrap: (host) => ({
            ...host,
            capture: {
              target: (canvas) =>
                lost
                  ? Effect.fail(new HostLost({ message: 'the capture browser disconnected', pending: false }))
                  : host.capture!.target(canvas),
            },
          }),
        }).pipe(Layer.provide(Layer.succeed(Hosts, hosts))),
      );
      const host = hosts.connected('managed')!;
      expect(yield* host.pages.live).toEqual([]);
      const answer = yield* doors.atNative('read_artifact_frames', { path, frames: [209] }, caller);
      if (answer.class !== 'answer') return yield* Effect.die(new Error(JSON.stringify(answer)));
      const drawn = yield* decodeFrames(answer.value);
      expect(drawn).toMatchObject({
        status: 'drawn',
        timeline: { duration: 7, fps: 30, width: 1920, height: 1080 },
        frames: [{ k: 209, width: 960, height: 540 }],
      });
      expect(drawn.frames[0]!.path.startsWith(scratch.path)).toBe(true);
      const png = yield* files.readFile(drawn.frames[0]!.path);
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(yield* host.pages.live).toEqual([]);
      expect(yield* doors.atNative('read_artifact_frames', { path, frames: [209] }, caller)).toMatchObject({
        class: 'answer',
        value: { status: 'drawn', frames: [{ k: 209, width: 960, height: 540 }] },
      });

      lost = true;
      expect(yield* doors.atNative('read_artifact_frames', { path, frames: [209] }, caller)).toMatchObject({
        class: 'refusal',
        code: 'browser-unavailable',
      });
    }),
  );
});
