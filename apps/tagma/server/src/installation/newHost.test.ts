import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Queue, Ref, Stream } from 'effect';
import { MachineHost } from './contract/service/machineHost.js';
import { NextInstallation } from './contract/service/next.js';
import { Succession } from './contract/service/succession.js';
import { framesWithNewHost } from './newHost.js';
import type { HostEnding } from './contract/wire/newHost.js';
import type { NextFrame } from './contract/wire/next.js';

const frame: NextFrame = {
  instance: 'new-host-fixture',
  pid: 1,
  revision: 1,
  readAt: '2026-10-27T13:00:00.000Z',
  readFrom: null,
  watched: false,
  issue: null,
  standing: { tone: 'alone', said: [{ text: 'nothing offers a next installation', strong: false }], behind: null },
  offers: [],
  update: null,
  back: null,
  installing: null,
  installed: null,
  acts: [],
};

const shell: HostEnding = { execution: 'x-1', incarnation: 0, activity: 'unread', title: 'idle shell', projectId: 1, thread: null };

it.effect('a host verdict that comes after the window subscribed reaches it as a frame carrying newHost, and so does its end', () =>
  Effect.gen(function* () {
    const frames = yield* Queue.unbounded<NextFrame>();
    const verdicts = yield* Queue.unbounded<string | null>();
    const stays = yield* Ref.make<string | null>(null);
    const feed = framesWithNewHost({
      next: NextInstallation.of({
        reading: Effect.die('the feed is read through its changes'),
        changes: Stream.fromQueue(frames),
        installing: Effect.die('nothing installs here'),
        install: () => Effect.die('nothing installs here'),
        stop: () => Effect.die('nothing installs here'),
      }),
      succession: Succession.of({
        current: Effect.succeed(null),
        leaving: Effect.succeed(false),
        restart: () => Effect.die('nothing restarts here'),
        refused: Effect.succeed(null),
        refusals: Stream.never,
        release: () => Effect.die('nothing restarts here'),
        settle: Effect.void,
      }),
      machineHost: MachineHost.of({
        standing: Effect.die('the feed reads no holdings'),
        build: Effect.succeed('v1 a'),
        endings: Effect.succeed([shell]),
        stays: Ref.get(stays),
        staying: Stream.fromQueue(verdicts),
      }),
      runs: { build: 'v2 b', digest: 'sha256:b' },
    });
    const seen = yield* Queue.unbounded<NextFrame>();
    yield* Effect.forkScoped(Stream.runForEach(feed, (said) => Queue.offer(seen, said)));

    yield* Queue.offer(frames, frame);
    expect((yield* Queue.take(seen)).newHost).toBeUndefined();

    yield* Ref.set(stays, 'the standing host of another build refused this build');
    yield* Queue.offer(verdicts, 'the standing host of another build refused this build');
    expect((yield* Queue.take(seen)).newHost).toEqual({
      cause: 'standing',
      build: 'v2 b',
      host: 'v1 a',
      detail: 'the standing host of another build refused this build',
      ends: [shell],
      back: null,
    });

    yield* Ref.set(stays, null);
    yield* Queue.offer(verdicts, null);
    expect((yield* Queue.take(seen)).newHost).toBeUndefined();
  }),
);
