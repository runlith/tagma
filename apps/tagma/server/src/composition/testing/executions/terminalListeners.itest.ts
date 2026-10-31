import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Context, Effect, Layer, Schedule, Schema, Stream } from 'effect';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostRequestKey, InstallationId } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { principalOf } from '../../../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../../../executions/terminals/subjectPolicy.js';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import { hostFixtureLayer, makeTerminalFloor } from './fixture.js';

const installation = InstallationId.make('held-listener');
const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const LISTENER = `const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } }); console.log('PORT ' + server.port);`;
const Port = Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65535 }));

class Fixture extends Context.Service<Fixture, Effect.Success<ReturnType<typeof makeTerminalFloor>>>()('testing/executions/HeldListener') {}
const fixture = Layer.effect(Fixture, makeTerminalFloor({ name: 'listener', installation, threads: [] })).pipe(
  Layer.provide(hostFixtureLayer('held-listener')),
  Layer.provide(HostRegistration.layer),
  Layer.provide(endpointConnection),
  Layer.provide(platform),
);

describe('a held terminal listing', () => {
  layer(fixture, { excludeTestServices: true })('host', (it) => {
    it.effect('carries the port its process listens on', () =>
      Effect.gen(function* () {
        const { terminals, projectId, checkout } = yield* Fixture;
        const actor: TerminalActor = { _tag: 'Operator' };
        const principal = principalOf(actor);
        const target = yield* terminals.target({ projectId, kind: 'host', cwd: checkout });
        const started = yield* terminals.start({
          actor,
          operationId: HostRequestKey.make('listener'),
          target,
          targetKey: targetKeyOf(targetIdentity(target, principal, principal)),
          program: process.execPath,
          args: ['-e', LISTENER],
          transport: 'pipes',
          lifetime: 'held',
        });
        if (started._tag !== 'Started') return yield* Effect.die(new Error(`the listener did not start: ${started._tag}`));
        const printed = yield* Stream.runLast(
          terminals.records({ ref: started.record.execution, stream: 'stdout', offset: ByteOffset.make('0') }).pipe(
            Stream.map((chunk) => (chunk._tag === 'Bytes' ? new TextDecoder().decode(chunk.bytes) : '')),
            Stream.scan(
              () => '',
              (held, text) => held + text,
            ),
            Stream.takeUntil((held) => held.includes('\n')),
          ),
        );
        const port = yield* Schema.decodeUnknownEffect(Port)((yield* Effect.fromOption(printed)).replace('PORT ', '').trim());
        const listed = yield* terminals
          .inventory(projectId, {})
          .pipe(Effect.repeat({ until: (now) => !now.stale, schedule: Schedule.spaced('50 millis') }));
        const row = listed.terminals.find((one) => one.record.execution.execution === started.record.execution.execution);
        expect(row?.listeners?.listeners.map((socket) => socket.port)).toEqual([port]);
      }),
    );
  });
});
