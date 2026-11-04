import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Clock, Effect, FileSystem, Layer } from 'effect';
import { Processes, ProcessesUnreadable } from '../../ProcessReader';
import { EvidenceReader } from '../../EvidenceScans';
import { PlatformFacts } from '../../PlatformFacts';
import { UsageSource } from '../../UsageReader';
import { Holder } from '../../holder/Holder';
import { platformLayer } from '../platform';
import { HOLDER_LIBRARY, testHolder } from '../../posix/testing/holder';
import { readUntil } from '../../holder/testing/Adapter';

it.live('Linux supplies witnessed process facts, listeners, resource accounting and actual pace through the host ports', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'linux-adapter-' });
    const layer = platformLayer(HOLDER_LIBRARY).pipe(Layer.provideMerge(testHolder(directory)));
    const services = yield* Layer.build(layer);
    yield* Effect.gen(function* () {
      const processes = yield* Processes;
      const holder = yield* Holder;
      const launching = yield* Clock.currentTimeMillis;
      const child = yield* holder.launch({
        id: 'linux-process',
        path: '/bin/sh',
        argv: ['sh', '-c', 'printf "ready\\n"; read line', '', 'one\ntwo'],
        env: [{ name: 'PRIVATE_VALUE', value: 'not-an-argument' }],
        cwd: directory,
        transport: { _tag: 'pipes', stdin: 'pipe' },
        pace: 'full',
      });
      const launched = yield* Clock.currentTimeMillis;
      yield* Effect.addFinalizer(() =>
        child.act('work', 'kill').pipe(Effect.andThen(child.exit), Effect.andThen(child.reap), Effect.andThen(child.release), Effect.orDie),
      );
      expect(processes.bornBetween(child.birth, launching - 20, launched + 20)).toBe(true);
      if (child.channels._tag !== 'pipes') return yield* Effect.die('the child has no pipe output');
      yield* readUntil(child.channels.stdout, 'ready\n');
      const identity = processes.identity(child.pid);
      expect(identity).toMatchObject({ _tag: 'Read', pid: child.pid, birth: child.birth, parent: holder.pid });
      expect(processes.compareBirth(child.birth, 'invalid')).toBeInstanceOf(ProcessesUnreadable);
      expect(processes.identity(0x1_0000_0000 + process.pid)).toMatchObject({ _tag: 'Unreadable' });
      const facts = yield* processes.facts([child.pid]);
      expect(facts.unread).toEqual([]);
      expect(facts.processes[0]?.args).toEqual({ _tag: 'Read', value: ['sh', '-c', 'printf "ready\\n"; read line', '', 'one\ntwo'] });
      expect(facts.processes[0]?.folder).toEqual({ _tag: 'Read', value: directory });
      const evidence = yield* EvidenceReader;
      const rows = yield* evidence.processes({ _tag: 'Pids', pids: [child.pid] });
      expect(rows.found[0]?.identity).toEqual({ pid: child.pid, birth: child.birth });
      const server = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({ hostname: '::', port: 0, fetch: () => new Response('ok') })),
        (server) => Effect.sync(() => server.stop(true)),
      );
      const listeners = yield* evidence.listeners({ _tag: 'Held', pids: [process.pid] });
      const own = listeners.found.find((row) => row.port === server.port);
      expect(own?.address).toBe('::');
      const caller = processes.identity(process.pid);
      if (caller._tag !== 'Read') return yield* Effect.die(new Error('the caller has no readable kernel witness'));
      expect(own?.holder).toEqual({ pid: caller.pid, birth: caller.birth });
      const platform = yield* PlatformFacts;
      expect(platform.identity.platform.os).toBe('linux');
      const standing = yield* platform.standing(() => {});
      const tasks = (pid: number) => Effect.map(files.readDirectory(`/proc/${pid}/task`), (names) => names.length);
      expect(standing.processes).toBeGreaterThanOrEqual((yield* tasks(process.pid)) + (yield* tasks(holder.pid)));
      expect(standing.descriptors).toBeGreaterThan(0);
      const usage = yield* (yield* UsageSource).open;
      const sampled = yield* usage.read({ others: false });
      expect(sampled.processes.find((row) => row.pid === process.pid)?.gpu._tag).toBe('Unavailable');
      expect(sampled.machine).toMatchObject({ memory: { _tag: 'Measured' } });
      const lowest = yield* holder.launch({
        id: 'linux-lowest',
        path: '/bin/sh',
        argv: ['sh', '-c', 'read line'],
        env: [],
        cwd: directory,
        transport: { _tag: 'pipes', stdin: 'pipe' },
        pace: 'lowest',
      });
      yield* Effect.addFinalizer(() =>
        lowest
          .act('work', 'kill')
          .pipe(Effect.andThen(lowest.exit), Effect.andThen(lowest.reap), Effect.andThen(lowest.release), Effect.orDie),
      );
      expect(lowest.pace).toBe(holder.capabilities.has('pace-raise') ? 'lowest' : 'full');
    }).pipe(Effect.provide(services));
  }).pipe(Effect.provide(BunServices.layer)),
);
