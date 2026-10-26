import { Context, Effect, Schema, Stream, type Layer, type Scope } from 'effect';
import type { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { HostRequestRef, type ExecutionRef, type InstallationId } from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import type { LaunchTransport } from '@runlith/executions/protocol/launch';
import { byteOffset, type Stream as StreamName } from '@runlith/executions/protocol/record';
import type { BindingScope } from '@runlith/executions/protocol/wire';
import { Adapter, type Scenario } from '../../holder/testing/Adapter';

export type Client = Effect.Success<ReturnType<typeof ExecutionClient.make>>;
export type HostControl = {
  readonly restartLogic: Effect.Effect<void, unknown>;
  readonly yieldLogic: Effect.Effect<void, unknown>;
  readonly loseHolder: Effect.Effect<void, unknown>;
};

export class Host extends Context.Service<
  Host,
  {
    readonly client: Client;
    readonly control: HostControl;
    readonly installation: InstallationId;
    readonly credits: number;
  }
>()('@runlith/execution-host/testing/Host') {}

export type HostAdapter = {
  readonly name: string;
  readonly steps: { readonly hangup: string; readonly interrupt: string; readonly terminate: string; readonly kill: string };
  readonly layer: Layer.Layer<Host | Adapter, unknown>;
};

let serial = 0;
export const operation = (host: Host['Service']) =>
  Schema.decodeUnknownEffect(HostRequestRef)({ installation: host.installation, operation: `contract-${++serial}` }).pipe(Effect.orDie);
export const principal = Schema.decodeUnknownSync(Principal)('contract-reader');

export const start = Effect.fnUntraced(function* (transport: LaunchTransport, scenario: Scenario, size?: number, paced = false) {
  const host = yield* Host;
  const adapter = yield* Adapter;
  const command = adapter.fixture(scenario, transport, size);
  const launched = yield* host.client.start(yield* operation(host), {
    command: {
      program: command.path,
      args: command.args,
      environment: [
        { name: 'PATH', value: adapter.searchPath },
        { name: 'HOME', value: adapter.home },
        { name: 'TERM', value: 'xterm-256color' },
      ],
      cwd: adapter.directory,
    },
    transport,
    lifetime: 'held',
    purpose: 'command',
    target: { environment: 'contract', namespace: 'contract', cwd: adapter.directory, dependencies: [] },
    holder: principal,
    origin: principal,
    paced: paced ? true : undefined,
  });
  if (launched._tag !== 'Started') return yield* Effect.die(new Error(`the host refused the fixture: ${JSON.stringify(launched)}`));
  return launched;
});

export const binding = Effect.fnUntraced(function* (host: Host['Service'], ref: ExecutionRef) {
  const opened = yield* host.client.openBinding(principal, ref);
  if (opened._tag !== 'Bound') return yield* Effect.die(new Error(`the input binding was refused: ${opened._tag}`));
  return { binding: opened.binding, principal } satisfies BindingScope;
});

export const textUntil = Effect.fnUntraced(function* (host: Host['Service'], ref: ExecutionRef, stream: StreamName, marker: string) {
  const needle = Buffer.from(marker);
  const chunks: Uint8Array[] = [];
  let tail = Buffer.alloc(0);
  let found = false;
  yield* host.client.subscribe({ _tag: 'Bytes', cursor: { ref, stream, offset: byteOffset(0n) } }, host.credits).pipe(
    Stream.filter((item) => item._tag === 'Bytes'),
    Stream.takeUntil((item) => {
      if (item._tag !== 'Bytes') return false;
      chunks.push(item.bytes);
      const scan = Buffer.concat([tail, item.bytes]);
      found = scan.includes(needle);
      tail = scan.subarray(Math.max(0, scan.length - needle.length + 1));
      return found;
    }),
    Stream.runDrain,
  );
  if (!found) return yield* Effect.die(new Error(`the stream ended before ${JSON.stringify(marker)}`));
  return Buffer.concat(chunks).toString();
});

export const bytes = Effect.fnUntraced(function* (host: Host['Service'], ref: ExecutionRef, stream: StreamName) {
  const collected = yield* host.client
    .subscribe({ _tag: 'Bytes', cursor: { ref, stream, offset: byteOffset(0n) } }, host.credits)
    .pipe(Stream.runCollect);
  return Buffer.concat(collected.flatMap((item) => (item._tag === 'Bytes' ? [item.bytes] : [])));
});

export const stop = Effect.fnUntraced(function* (host: Host['Service'], ref: ExecutionRef, action: 'signal' | 'destroy' = 'signal') {
  return yield* host.client.stop(yield* operation(host), ref, 'explicit-stop', action);
});

export const withExecution = <A, E>(host: Host['Service'], ref: ExecutionRef, body: Effect.Effect<A, E, Scope.Scope>) =>
  body.pipe(Effect.ensuring(Effect.orDie(Effect.asVoid(stop(host, ref, 'destroy')))));
