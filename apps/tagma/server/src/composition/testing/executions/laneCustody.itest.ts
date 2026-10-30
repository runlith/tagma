import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Context, Effect, Fiber, Layer, Ref, Stream } from 'effect';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { hostAddress } from '@runlith/executions/hostAddress';
import { InstallationId, HostRequestKey } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { SessionIdentity } from '../../../platform/contract/wire/session.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../../../executions/terminals/subjectPolicy.js';
import type { TerminalStart } from '../../../executions/contract/service/terminals.js';
import { guardedFloor } from '../../../executions/testing/guardedFloor.js';
import { executionHost, executionPolicy, terminalHostCustody } from '../../../executions/testing/doubles.js';
import { shippedChain } from '../../../platform/store/chain.js';
import { sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { fixtureMigrations } from '../migrations.js';
import { hostFixtureLayer, makeHostCase } from './fixture.js';

const installation = InstallationId.make('held-stdin');
const thread = ThreadId.make('held-stdin-thread');
const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const makeFixture = Effect.gen(function* () {
  const raised = yield* makeHostCase({ name: 'pipe', installation, threads: [thread] });
  const connection = yield* executionHost(yield* hostAddress(raised.canonical, 'held-stdin'));
  const store = Context.get(raised.context, MachineStore);
  const custody = yield* terminalHostCustody({
    executions: connection.port,
    welcome: connection.welcome,
    installation,
    state: raised.canonical,
    offered: {
      bundle: raised.bundle.root,
      digest: raised.bundle.manifest.identity.digest,
      database: store.schema,
      application: shippedChain(fixtureMigrations),
      policy: executionPolicy(),
      lifetime: 'with-parent',
    },
  });
  yield* Ref.set(connection.opened, custody.opened);
  const { terminals } = yield* guardedFloor({
    port: connection.port,
    guarded: custody.guarded(),
    db: store.db,
    installation,
  }).pipe(Effect.provide(Context.add(raised.context, SessionIdentity, sessionIdentity)));
  return { ...raised, terminals };
});
class Fixture extends Context.Service<Fixture, Effect.Success<typeof makeFixture>>()('testing/executions/HeldStdin') {}
const fixture = Layer.effect(Fixture, makeFixture).pipe(
  Layer.provide(hostFixtureLayer('held-stdin')),
  Layer.provide(HostRegistration.layer),
  Layer.provide(endpointConnection),
  Layer.provide(platform),
);

describe('held stdin at the native host boundary', () => {
  layer(fixture, { excludeTestServices: true })('host', (it) => {
    it.effect('held stdin rejects other launch modes, writes and ends its own child, and cannot be spent at another execution', () =>
      Effect.gen(function* () {
        const { terminals, projectId, checkout } = yield* Fixture;
        const actor = { _tag: 'Thread', threadId: thread, projectId } as const;
        const principal = principalOf(actor);
        const target = yield* terminals.target({ projectId, kind: 'host', cwd: checkout });
        const request: TerminalStart = {
          actor,
          operationId: HostRequestKey.make('pipe-first'),
          target,
          targetKey: targetKeyOf(targetIdentity(target, principal, principal)),
          program: '/bin/cat',
          args: [],
          transport: 'pipes',
          lifetime: 'call',
          purpose: 'internal',
          stdinHeld: true,
        };
        const ineligible: readonly TerminalStart[] = [
          { ...request, operationId: HostRequestKey.make('pipe-pty'), transport: 'pty', geometry: { rows: 24, columns: 80 } },
          { ...request, operationId: HostRequestKey.make('pipe-held'), lifetime: 'held' },
          { ...request, operationId: HostRequestKey.make('pipe-command'), purpose: 'command' },
          { ...request, operationId: HostRequestKey.make('pipe-interactive'), interactive: { revision: 1 } },
        ];
        for (const launch of ineligible) {
          const refused = yield* Effect.flip(terminals.start(launch));
          expect(refused).toMatchObject({ _tag: 'TerminalRefused', reason: 'ineligible' });
          if (refused._tag === 'TerminalRefused') expect(refused.message).toContain('Held stdin');
        }
        const first = yield* terminals.start(request);
        const second = yield* terminals.start({ ...request, operationId: HostRequestKey.make('pipe-second') });
        if (first._tag !== 'Started' || first.pipe === undefined || second._tag !== 'Started' || second.pipe === undefined)
          return yield* Effect.die(new Error('the held-stdin starts opened no pipes'));
        const reading = yield* Effect.forkScoped(
          Stream.runCollect(terminals.records({ ref: first.record.execution, stream: 'stdout', offset: ByteOffset.make('0') })),
        );
        expect((yield* terminals.pipeInput(first.pipe, { _tag: 'Write', bytes: new TextEncoder().encode('piped\n') }, 0))._tag).toBe(
          'InputAdmitted',
        );
        const crossed = yield* Effect.result(
          terminals.pipeInput(
            { ...first.pipe, execution: second.pipe.execution },
            { _tag: 'Write', bytes: new TextEncoder().encode('crossed\n') },
            1,
          ),
        );
        expect(crossed._tag === 'Failure' || (crossed._tag === 'Success' && crossed.success._tag !== 'InputAdmitted')).toBe(true);
        const ending = yield* terminals.pipeInput(first.pipe, { _tag: 'End' }, 1);
        expect(['InputAdmitted', 'InputEnded']).toContain(ending._tag);
        const recorded = [...(yield* Fiber.join(reading))];
        expect(Buffer.concat(recorded.flatMap((chunk) => (chunk._tag === 'Bytes' ? [chunk.bytes] : []))).toString()).toBe('piped\n');
        expect(recorded.at(-1)?._tag).toBe('Ended');
        yield* terminals.pipeInput(second.pipe, { _tag: 'End' }, 0);
      }),
    );
  });
});
