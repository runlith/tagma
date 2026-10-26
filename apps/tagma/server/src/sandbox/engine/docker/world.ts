import { Effect, FileSystem, Layer, Schema } from 'effect';
import { WorkingStat, workingOf, type Working } from '@runlith/files/working';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { ChildProcessSpawner } from 'effect/process';
import type { World } from '@runlith/agent-tools/world';
import { gitLayer } from '@runlith/git/Git';
import { type GuestChannel, openGuestChannel } from './channel.js';
import { GuestExec } from './exec.js';
import { guestFileLayer } from './fileLayer.js';
import { GUEST_HOME, GUEST_RIPGREP, GUEST_SHELL, GUEST_TMP, GUEST_TREE, type Guest } from './layout.js';
import { GuestUnavailable } from './wire.js';

const hostSpawner = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

const takeHostSpawner = Effect.provide(ChildProcessSpawner.ChildProcessSpawner, hostSpawner);

export const dockerGuestWorld = Effect.fn('dockerGuestWorld')(function* (guest: Guest) {
  const host = yield* takeHostSpawner;
  const channel = yield* openGuestChannel(guest, host);
  const world = guestWorld(channel, guest, host);
  const scratch = `${GUEST_HOME}/scratch`;
  yield* Effect.provide(
    Effect.flatMap(FileSystem.FileSystem, (files) => files.makeDirectory(scratch, { recursive: true })),
    world.files,
  ).pipe(
    Effect.mapError(
      (cause) => new GuestUnavailable({ container: guest.container, reason: `the scratch could not be made: ${cause.message}` }),
    ),
  );
  return { world, root: GUEST_TREE, scratch, alive: () => channel.standing };
});

const WorkingAnswer = Schema.Struct({ working: WorkingStat, now: Schema.Number });

const guestWorking = Effect.fn('GuestWorld.working')(function* (channel: GuestChannel, path: string): Effect.fn.Return<Working> {
  const frame = yield* channel.call({ op: 'working', path }).pipe(Effect.result);
  if (frame._tag === 'Failure') return { kind: 'unread', cause: `the guest did not answer: ${frame.failure.message}` };
  if (!frame.success.ok) {
    const error = frame.success.value.error;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? { kind: 'absent', key: 'absent' }
      : { kind: 'unread', cause: `the guest could not stat ${path}: ${JSON.stringify(error)}` };
  }
  const decoded = Schema.decodeUnknownResult(WorkingAnswer)(frame.success.value);
  return decoded._tag === 'Failure'
    ? { kind: 'unread', cause: `the guest answered a stat that does not decode: ${decoded.failure.message}` }
    : workingOf(decoded.success.working, decoded.success.now);
});

function guestWorld(channel: GuestChannel, guest: Guest, host: ChildProcessSpawner.ChildProcessSpawner['Service']) {
  return {
    files: guestFileLayer(channel),
    exec: GuestExec(guest, host),
    git: gitLayer.pipe(Layer.provide(GuestExec(guest, host))),
    working: (path) => guestWorking(channel, path),
    environment: {
      platform: 'linux',
      shell: GUEST_SHELL,
      tmp: GUEST_TMP,
      executables: {
        ripgrep: Effect.succeed(GUEST_RIPGREP),
      },
    },
  } satisfies World;
}
