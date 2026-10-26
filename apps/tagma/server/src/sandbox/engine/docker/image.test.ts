import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { createHash } from 'node:crypto';
import { Effect, Fiber, FileSystem, Sink, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { ChildProcessSpawner } from 'effect/process';
import { buildGuestImage, dockerSaid, namedImage } from './image.js';

it.effect('image preparation replaces an unlabelled build identity and reuses the resulting image', () =>
  Effect.gen(function* () {
    const source = new TextEncoder().encode('fixture input');
    const oldRevision = createHash('sha256').update(source).update(source).update(source).digest('hex').slice(0, 16);
    const oldDigest = `sha256:${'a'.repeat(64)}`;
    const producedDigest = `sha256:${'b'.repeat(64)}`;
    const images = new Map([[`tagma-code-guest:${oldRevision}`, { digest: oldDigest, revision: oldRevision, protocol: '' }]]);
    let generation = 0;
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        if (command._tag !== 'StandardCommand') throw new Error('the image engine accepts one command');
        const args = command.args;
        let output = '';
        let code = 0;
        if (args[0] === 'build') {
          const labels = args.flatMap((value, index) => (value === '--label' ? [args[index + 1]!] : []));
          const revision = labels.find((label) => label.startsWith('tagma.guest.revision='))!.split('=')[1]!;
          const protocol = labels.find((label) => label.startsWith('tagma.guest.protocol='))?.split('=')[1] ?? '';
          generation += 1;
          images.set(args[args.indexOf('--tag') + 1]!, {
            digest: generation === 1 ? producedDigest : `sha256:${'c'.repeat(64)}`,
            revision,
            protocol,
          });
        } else {
          const image = images.get(args.at(-1)!);
          if (image === undefined) {
            code = 1;
            output = 'No such image';
          } else
            output = args.includes('{{.Id}}')
              ? image.digest
              : JSON.stringify({
                  Id: image.digest,
                  Os: 'linux',
                  Architecture: 'arm64',
                  Config: {
                    Labels: {
                      'tagma.guest.revision': image.revision,
                      'tagma.guest.protocol': image.protocol === '' ? undefined : image.protocol,
                    },
                  },
                });
        }
        const bytes = Stream.make(new TextEncoder().encode(output));
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: bytes,
          stderr: Stream.empty,
          all: bytes,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      }),
    );
    const result = yield* Effect.gen(function* () {
      const first = yield* buildGuestImage(undefined);
      const admitted = yield* namedImage(first.reference);
      const reused = yield* buildGuestImage(undefined);
      return { first, admitted, reused };
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({ readFile: () => Effect.succeed(source) })),
    );
    expect(result.first.digest).toBe(producedDigest);
    expect(result.admitted.image).toEqual(result.first);
    expect(result.reused).toEqual(result.first);
  }),
);

it.effect('a Docker control timeout releases its scoped process acquisition and returns a typed refusal', () =>
  Effect.gen(function* () {
    let held = false;
    const spawner = ChildProcessSpawner.make(() =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            held = true;
          }),
          () =>
            Effect.sync(() => {
              held = false;
            }),
        );
        return yield* Effect.never;
      }),
    );
    const result = yield* Effect.gen(function* () {
      const running = yield* Effect.result(dockerSaid(['image', 'inspect', 'prepared'], 'read the prepared image')).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(held).toBe(true);
      yield* TestClock.adjust('15 seconds');
      expect(held).toBe(false);
      return yield* Fiber.join(running);
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure._tag).toBe('GuestUnavailable');
  }),
);
