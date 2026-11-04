import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Fiber, FileSystem, Layer, Path, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Git, gitLayer } from '@runlith/git/Git';
import type { CheckoutsMoved } from '../contract/service/checkouts.js';
import { WatchTickets } from '../../platform/contract/service/watch.js';
import { watchTickets } from '../../platform/watch/tickets.js';
import { watchProcessLayer } from '../../composition/testing/fileWatcher.js';
import { makeTopologyWatches } from './topology.js';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const layers = Layer.mergeAll(BunFileSystem.layer, Path.layer, gitLayer.pipe(Layer.provide(host)), watchProcessLayer);

const until = (events: Queue.Queue<CheckoutsMoved>, watching: boolean) =>
  Stream.runHead(Stream.filter(Stream.fromQueue(events), (event) => event.watching === watching));

it.live('a repository whose folder is deleted ends the observation of its checkouts and frees its watchers', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const root = `${yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'topology-watch-' }))}/project`;
    yield* files.makeDirectory(root);
    expect((yield* git.run(['init', '-q', '-b', 'main'], { cwd: root })).status).toBe(0);
    const tickets = watchTickets(8);
    yield* Effect.gen(function* () {
      const watches = yield* makeTopologyWatches;
      const events = yield* Queue.unbounded<CheckoutsMoved>();
      const fiber = yield* Stream.runForEach(watches.moved(root), (event) => Queue.offer(events, event)).pipe(Effect.forkScoped);
      yield* until(events, true);
      yield* files.remove(root, { recursive: true });
      yield* until(events, false);
      yield* TestClock.adjust(2000);
      yield* Fiber.join(fiber);
      expect(tickets.standing().active).toBe(0);
    }).pipe(Effect.provideService(WatchTickets, tickets), Effect.provide(TestClock.layer()));
  }).pipe(Effect.provide(layers)),
);

it.live('a folder holding no repository is observed once a repository is made in it, with no clock moving', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'topology-bare-' }));
    const [root, made] = [`${home}/project`, `${home}/made`];
    yield* Effect.forEach([root, made], (path) => files.makeDirectory(path));
    expect((yield* git.run(['init', '-q', '-b', 'main'], { cwd: made })).status).toBe(0);
    yield* Effect.gen(function* () {
      const watches = yield* makeTopologyWatches;
      const events = yield* Queue.unbounded<CheckoutsMoved>();
      yield* Stream.runForEach(watches.moved(root), (event) => Queue.offer(events, event)).pipe(Effect.forkScoped);
      yield* until(events, false);
      yield* until(events, false);
      yield* files.rename(`${made}/.git`, `${root}/.git`);
      yield* until(events, true);
    }).pipe(Effect.provideService(WatchTickets, watchTickets(8)), Effect.provide(TestClock.layer()));
  }).pipe(Effect.provide(layers)),
);
