import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { hostname } from 'node:os';
import { Effect, Schema, Stream } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { Principal } from '@runlith/executions/protocol/custody';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import { hostPolicy, hostShare, hostWireLimits } from './hostFixture';
import { makeWorld } from './composition/testing/servedWorld';

const policy = hostPolicy({ executions: 2, transports: ['pipes'], custodyReceipts: 8 });
const limits = hostWireLimits(policy, 2, { envelopeBytes: 16384, connections: 4, requests: 8 });
const Port = Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65535 }));
const LISTENER = `const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } }); console.log('PORT ' + server.port);`;

it.live('wire evidence identifies the child and its socket, names incomplete process coverage, and leaves the listener running', () =>
  Effect.gen(function* () {
    const { client, directory, registration } = yield* makeWorld({
      prefix: 'evidence-dispatch-',
      policy,
      share: hostShare(policy, 2),
      limits,
    });
    const key = (name: string) => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
    const took = yield* client.take(key('evidence-take'), 0);
    if (took._tag !== 'Held') return yield* Effect.die(new Error(`custody: ${took._tag}`));
    const launched = yield* client.start(key('evidence-listener'), {
      command: { program: process.execPath, args: ['-e', LISTENER], environment: [{ name: 'HOME', value: directory }], cwd: directory },
      transport: { _tag: 'pipes', stdin: 'ignore' },
      lifetime: 'held',
      purpose: 'command',
      target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
      holder: Principal.make('tester'),
      origin: Principal.make('tester'),
    });
    if (launched._tag !== 'Started') return yield* Effect.die(new Error(`start: ${launched._tag}`));
    yield* Effect.addFinalizer(() => Effect.orDie(client.stop(key('evidence-stop'), launched.execution, 'explicit-stop', 'signal')));
    const line = yield* Stream.runLast(
      client
        .subscribe({ _tag: 'Bytes', cursor: { ref: launched.execution, stream: 'stdout', offset: byteOffset(0n) } }, limits.credits)
        .pipe(
          Stream.map((delivery) => (delivery._tag === 'Bytes' ? new TextDecoder().decode(delivery.bytes) : '')),
          Stream.scan(
            () => '',
            (held, chunk) => held + chunk,
          ),
          Stream.takeUntil((held) => held.includes('\n')),
        ),
    );
    const port = yield* Schema.decodeUnknownEffect(Port)((yield* Effect.fromOption(line)).replace('PORT ', '').trim());
    const pid = launched.native.pid;
    const listeners = yield* client.listeners(launched.execution);
    const socket = listeners?.listeners.find((listener) => listener.port === port);
    expect(socket?.holder.pid).toBe(pid);
    expect(socket?.association).toEqual({ execution: launched.execution, relation: 'leader', identity: 'same' });
    expect(socket?.holder.birth).toBeDefined();
    expect(listeners?.subject).toEqual({ _tag: 'Execution', execution: launched.execution });
    expect(listeners?.scope.network).toEqual({ _tag: 'Local', machine: hostname() });

    const processes = yield* client.processes(launched.execution);
    const leader = processes?.processes.find((row) => row.identity.pid === pid);
    expect(leader?.association).toEqual({ execution: launched.execution, relation: 'leader', identity: 'same' });
    expect(leader?.identity.birth).toBeDefined();
    expect(processes?.completeness).toBe('partial');
    expect(processes?.unmeasured.some((region) => region.region.includes(`descended from pid ${pid}`))).toBe(true);

    const namespace = yield* client.hostListeners();
    expect(namespace.subject).toEqual({ _tag: 'Namespace' });
    expect(namespace.scope.network).toEqual({ _tag: 'Local', machine: hostname() });
    expect(
      namespace.unmeasured.some((region) => region.reason === 'truncated') ||
        namespace.listeners.some((listener) => listener.port === port),
    ).toBe(true);
    const inventoried = namespace.listeners.find((listener) => listener.port === port);
    if (inventoried !== undefined) {
      expect(inventoried.association).toEqual({ execution: launched.execution, relation: 'leader', identity: 'same' });
    }
    const summary = yield* client.state(launched.execution);
    expect(summary?.state.nativeExit).toBeUndefined();
    expect(summary?.state.phase).toBe('running');
    yield* Effect.acquireRelease(
      Effect.promise(() => Bun.connect({ hostname: '127.0.0.1', port, socket: { data() {} } })),
      (connected) => Effect.sync(() => connected.end()),
    );
  }).pipe(Effect.provide(HostRegistration.layer), Effect.provide(endpointConnection), Effect.provide(BunServices.layer)),
);
