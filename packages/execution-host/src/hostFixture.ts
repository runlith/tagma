import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer, Result, Schema } from 'effect';
import { Holder, HolderRefused } from './holder/Holder';
import {
  CapabilityProfile,
  ExecutionPolicy,
  type MachineReading,
  type UsagePolicy,
  ceilingsOf,
  grantOf,
  reserveOf,
} from '@runlith/executions/protocol/capacity';
import { ConnectionId, Registration } from '@runlith/executions/protocol/registration';
import { HostRequestRef, type Transport } from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import { type WireLimits, wireLimits } from '@runlith/executions/protocol/wire';

import { PlatformFacts, type TransportExpenses } from './PlatformFacts';
import { ExecutionCapacity } from './ExecutionCapacity';
import { recordDescriptors } from './RecordWriter';
import { readerDescriptors } from './ExecutionRecord';

export const INSTALLATION = 'installation-1';

export const serving = async (child: Bun.Subprocess<'pipe', 'pipe', 'pipe'>, mark: string): Promise<() => string> => {
  let held = '';
  await new Promise<void>((resolve, reject) => {
    const watch = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        held += decoder.decode(chunk, { stream: true });
        if (held.includes(mark)) resolve();
      }
    };
    Promise.all([watch(child.stdout), watch(child.stderr)]).catch(reject);
    child.exited.then((code) => reject(new Error(`the host exited ${code} before reporting itself serving; it printed: ${held}`)), reject);
  });
  return () => held;
};

export const fixtureHolder = (bound?: number) =>
  Layer.effect(
    Holder,
    Effect.sync(() => {
      let generation: number | undefined = bound;
      const unsupported = (act: HolderRefused['act']) =>
        Effect.fail(new HolderRefused({ act, reason: 'unsupported', detail: 'this fixture holds generation metadata only' }));
      return Holder.of({
        pid: 1,
        generation: Effect.sync(() => generation),
        bindGeneration: (offered) =>
          Effect.suspend(() => {
            if (generation !== undefined && generation !== offered)
              return Effect.fail(
                new HolderRefused({ act: 'bind-generation', reason: 'changed', detail: 'the fixture already holds another generation' }),
              );
            generation = offered;
            return Effect.void;
          }),
        capabilities: new Set(),
        descriptors: { limit: 'absent', expense: { pty: 0, pipes: 0 }, copies: { pty: 0, pipes: 0 } },
        held: [],
        launch: () => unsupported('launch'),
        pace: () => unsupported('pace'),
        ready: Effect.void,
        vacate: Effect.void,
        prepare: () => unsupported('prepare'),
        activate: unsupported('activate'),
        lost: Effect.never,
      });
    }),
  );

const decodeProfile = Schema.decodeUnknownSync(CapabilityProfile);
const decodePolicy = Schema.decodeUnknownSync(ExecutionPolicy);
const decodeRegistration = Schema.decodeUnknownSync(Registration);
const decodeConnection = Schema.decodeUnknownSync(ConnectionId);
const decodePrincipal = Schema.decodeUnknownSync(Principal);
const decodeOperation = Schema.decodeUnknownSync(HostRequestRef);

const INPUT_PENDING = 1024;
const INPUT_RECEIPTS = 4;
const OUTPUT_LANDING = 1024;
const OUTPUT_RETAINED = 4096;
const PARSER_PENDING = 512;
const PARSER_CELLS = 512;
const TERMINAL_PARSER_PENDING = 6 * OUTPUT_LANDING;
const TERMINAL_PARSER_CELLS = 2 * 1024 * 1024;
const TERMINAL_FRAME_BYTES = 1024 * 1024;
const EXECUTION_RECEIPTS = 4;

export type HostSizing = {
  readonly executions?: number;
  readonly transports?: ReadonlyArray<Transport>;
  readonly custodyReceipts?: number;
  readonly usage?: UsagePolicy;
};

export const hostPolicy = (options: HostSizing = {}): ExecutionPolicy => {
  const executions = options.executions ?? 1;
  const transports = options.transports ?? ['pipes', 'pty'];
  const streams = transports.includes('pipes') ? 2 : 1;
  const terminal = transports.includes('pty');
  const parserPending = terminal ? TERMINAL_PARSER_PENDING : PARSER_PENDING;
  const parserCells = terminal ? TERMINAL_PARSER_CELLS : PARSER_CELLS;
  return decodePolicy({
    transports,
    relations: ['leader'],
    execution: {
      input: { pendingBytes: INPUT_PENDING, chunkBytes: INPUT_PENDING, receipts: INPUT_RECEIPTS },
      output: { landingBytes: OUTPUT_LANDING, segmentBytes: OUTPUT_LANDING, retainedBytes: OUTPUT_RETAINED },
      parser: { pendingBytes: parserPending, cellBytes: parserCells },
      geometry: { columns: 80, rows: 24, scrollbackRows: 100 },
      read: { chunkBytes: OUTPUT_LANDING, readerCredits: OUTPUT_LANDING, readers: 2 },
      frame: { bytes: terminal ? TERMINAL_FRAME_BYTES : 1024, inFlight: 1 },
      receipts: EXECUTION_RECEIPTS,
    },
    host: {
      bindings: options.custodyReceipts ?? 8,
      custodyReceipts: options.custodyReceipts ?? 8,
      tombstones: 4,
    },
    usage: options.usage,
  });
};

const fixtureReserve = (policy: ExecutionPolicy) => reserveOf(policy.execution, policy.transports.includes('pty') ? 'pty' : 'pipes');

export const hostShare = (policy: ExecutionPolicy, executions = 1): number => ((executions + 0.5) * fixtureReserve(policy)) / totalmem();

const fixtureExpenses: TransportExpenses = { pty: { holder: 4, logic: 1 }, pipes: { holder: 4, logic: 3 } };

export const fixtureMachine = (policy: ExecutionPolicy, executions: number): MachineReading => {
  const machineBytes = Math.ceil(4 * (executions + 0.5) * fixtureReserve(policy));
  const descriptors = ExecutionCapacity.descriptors(policy, fixtureExpenses);
  return {
    granted: grantOf(((executions + 0.5) * fixtureReserve(policy)) / machineBytes, machineBytes),
    descriptors,
    limits: {
      openFiles: executions * Math.max(descriptors.pipes.logic, descriptors.pty.logic),
      holderFiles: executions * Math.max(descriptors.pipes.holder, descriptors.pty.holder),
      processes: executions,
      terminals: executions,
    },
    standing: { terminals: 0, processes: 0, descriptors: 0, holderDescriptors: 0 },
  };
};

export const hostProfile = (options: HostSizing = {}): CapabilityProfile => {
  const policy = hostPolicy(options);
  const machine = fixtureMachine(policy, options.executions ?? 1);
  return decodeProfile({
    ...policy,
    version: 1,
    platform: { os: process.platform, arch: process.arch },
    runtime: { name: 'bun', version: '1.4.2' },
    native: { crate: 'execution-platform', version: '0.1.0', build: 'fixture' },
    granted: machine.granted,
    ceilings: ceilingsOf(policy, machine),
  });
};

export const fixtureFacts = (
  policy: ExecutionPolicy,
  executions = 1,
  machine: MachineReading = fixtureMachine(policy, executions),
): PlatformFacts['Service'] => {
  const profile = hostProfile({ executions, transports: policy.transports });
  const expense = (transport: Transport) => ({
    holder: machine.descriptors[transport].holder,
    logic: machine.descriptors[transport].logic - recordDescriptors(transport) - readerDescriptors(policy.execution, transport),
  });
  return PlatformFacts.of({
    identity: {
      platform: profile.platform,
      runtime: profile.runtime,
      native: profile.native,
      transports: profile.transports,
      relations: profile.relations,
    },
    descriptors: { pipes: expense('pipes'), pty: expense('pty') },
    limits: Effect.succeed(machine.limits),
    standing: (observe) =>
      Effect.sync(() => {
        observe();
        return machine.standing;
      }),
    recountMs: 0,
    uptimeNanos: () => process.hrtime.bigint(),
  });
};

export const hostWireLimits = (
  policy: ExecutionPolicy,
  executions: number,
  supplied: { readonly envelopeBytes: number; readonly connections: number; readonly requests: number },
): WireLimits => wireLimits(policy, { ...supplied, subscriptions: executions * policy.execution.read.readers });

export const registrationOf = (directory: string): Registration =>
  decodeRegistration({
    version: 1,
    state: directory,
    installation: INSTALLATION,
    protocol: 'executions/1',
    endpoint: { transport: 'unix', path: join(directory, 'host.sock') },
    credentials: { custodian: join(directory, 'custodian'), recovery: join(directory, 'recovery') },
  });

export const hostTestRoot = (): string => join(tmpdir(), 'runlith-executions');

export const stateDirectories = (prefix: string) => {
  const made: string[] = [];
  return {
    open: (): string => {
      const root = hostTestRoot();
      mkdirSync(root, { recursive: true });
      const directory = mkdtempSync(join(root, prefix));
      made.push(directory);
      return directory;
    },
    clear: (): void => {
      for (const directory of made) rmSync(directory, { recursive: true, force: true });
    },
  };
};

export const connectionOf = (name: string): ConnectionId => decodeConnection(name);
export const principalOf = (name: string): Principal => decodePrincipal(name);
export const keyOf = (name: string): HostRequestRef => decodeOperation({ installation: INSTALLATION, operation: name });

export const tagOf = <A, E>(outcome: Result.Result<A, E>): string =>
  Result.isFailure(outcome) ? String((outcome.failure as { _tag?: string })._tag) : 'success';

export const spawned = async (
  argv: ReadonlyArray<string>,
  options: { readonly cwd?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const child = Bun.spawn([...argv], { cwd: options.cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
};

export const signalConnection = async (signal: NodeJS.Signals): Promise<number> => {
  const listed = await spawned(['pgrep', '-P', String(process.pid)]);
  const children = listed.stdout
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  let signalled = 0;
  for (const pid of children) {
    const described = await spawned(['ps', '-o', 'command=', '-p', String(pid)]);
    if (!described.stdout.includes('sqlite-process')) continue;
    process.kill(pid, signal);
    signalled += 1;
  }
  return signalled;
};
