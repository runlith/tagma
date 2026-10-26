import { type Waiters, waiters } from '@runlith/held/Waiters';
import { Cause, Effect, Exit, Queue, Stream } from 'effect';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';
import { GUEST_PROGRAM, GUEST_REGISTER, GUEST_INTERPRETER, type Guest } from './layout.js';
import { askFrame, GuestChannelLost, GuestFrames, GuestUnavailable, type GuestRequest, type GuestFrame } from './wire.js';

export function executionId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

export function killCommand(guest: Guest, id: string, signal: string): readonly string[] {
  return ['exec', guest.container, GUEST_INTERPRETER, GUEST_PROGRAM, 'kill', JSON.stringify({ id, dir: GUEST_REGISTER, signal })];
}

export type GuestChannel = ReturnType<typeof makeGuestChannel>;

const makeGuestChannel = (input: {
  readonly requests: Queue.Queue<Uint8Array, Cause.Done>;
  readonly replies: Waiters<number, GuestFrame, GuestChannelLost>;
}) => {
  const { requests, replies } = input;
  const frames = new GuestFrames();
  let counter = 0;
  let broken: GuestChannelLost | null = null;

  return {
    get standing(): boolean {
      return broken === null;
    },

    call: Effect.fn('GuestChannel.call')(function* (ask: GuestRequest, payload?: Uint8Array) {
      if (broken !== null) return yield* broken;
      counter += 1;
      const id = counter;
      return yield* replies.wait(id, Queue.offer(requests, askFrame(id, ask, payload)));
    }),

    receive: (chunk: Uint8Array) => {
      for (const frame of frames.read(chunk)) replies.complete(frame.id, Exit.succeed(frame));
    },

    breaks: (reason: string) => {
      if (broken !== null) return;
      broken = new GuestChannelLost({ reason });
      replies.completeAll(Exit.fail(broken));
    },
  };
};

export const openGuestChannel = Effect.fn('GuestChannel.open')(function* (
  guest: Guest,
  host: ChildProcessSpawner.ChildProcessSpawner['Service'],
) {
  const id = executionId();
  const requests = yield* Queue.make<Uint8Array, Cause.Done>();
  const started = yield* host
    .spawn(
      ChildProcess.make(
        'docker',
        ['exec', '-i', guest.container, GUEST_INTERPRETER, GUEST_PROGRAM, 'serve', JSON.stringify({ id, dir: GUEST_REGISTER })],
        { stdin: Stream.fromQueue(requests), stdout: 'pipe', stderr: 'pipe' },
      ),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new GuestUnavailable({
            container: guest.container,
            reason: `the guest helper would not start: ${cause.message}`,
          }),
      ),
    );
  const replies = yield* waiters<number, GuestFrame, GuestChannelLost>({ name: 'guest-replies', owner: 'sandbox', key: String });
  const channel = makeGuestChannel({ requests, replies });
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      channel.breaks('the world that opened this channel was closed');
      yield* Queue.end(requests);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const ending = yield* host.spawn(ChildProcess.make('docker', [...killCommand(guest, id, 'SIGKILL')], { stdin: 'ignore' }));
          yield* ending.exitCode;
        }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: '15 seconds',
          orElse: () =>
            Effect.logWarning('Docker did not confirm guest helper cleanup within 15 seconds', {
              container: guest.container,
              execution: id,
            }),
        }),
        Effect.catchCause((cause) =>
          Effect.logWarning('the guest helper could not be killed as the channel closed', {
            container: guest.container,
            execution: id,
            reason: Cause.squash(cause),
          }),
        ),
      );
    }),
  );
  yield* Effect.forkScoped(
    started.stdout.pipe(
      Stream.runForEach((chunk) => Effect.sync(() => channel.receive(chunk))),
      Effect.andThen(Effect.sync(() => channel.breaks('the guest helper closed its output'))),
      Effect.exit,
      Effect.tap((exit) =>
        Exit.isFailure(exit)
          ? Effect.sync(() => channel.breaks(`the guest helper stopped answering: ${Cause.pretty(exit.cause)}`))
          : Effect.void,
      ),
    ),
  );
  const alive = yield* channel.call({ op: 'realPath', path: '/' }).pipe(
    Effect.timeoutOrElse({
      duration: '15 seconds',
      orElse: () => Effect.fail(new GuestChannelLost({ reason: 'the guest helper did not answer within 15 seconds' })),
    }),
    Effect.mapError((broken: GuestChannelLost) => new GuestUnavailable({ container: guest.container, reason: broken.reason })),
  );
  if (!alive.ok) {
    return yield* new GuestUnavailable({
      container: guest.container,
      reason: 'the guest helper answered its first request with a failure',
    });
  }
  return channel;
});
