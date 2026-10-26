import type { DeclaredCancellationCause } from '@runlith/executions/protocol/call';
import type { ByteOffset, Stream } from '@runlith/executions/protocol/record';
import type { CommandOrder } from '@tagma/server/executions/contract/wire/commands';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { ProjectDoor } from '$lib/features/workspace/ProjectDoor.js';
import type { Door } from '$lib/wire/Door.js';

export type ExecutionAddress = { readonly execution: string; readonly incarnation: number };

export const terminalKey = (address: ExecutionAddress): string => `${address.execution}:${address.incarnation}`;

export const terminalAddress = (key: string): ExecutionAddress | null => {
  const cut = key.lastIndexOf(':');
  if (cut <= 0) return null;
  const incarnation = Number(key.slice(cut + 1));
  return Number.isInteger(incarnation) && incarnation >= 0 ? { execution: key.slice(0, cut), incarnation } : null;
};

export type ByteWindow = ExecutionAddress & {
  readonly stream: Stream;
  readonly offset: ByteOffset;
  readonly limit?: number;
  readonly positions?: boolean;
};

export type CommandByteWindow = ByteWindow & { readonly stream: 'stdout' | 'stderr' | 'output' };

export type InventoryKey = {
  readonly standing?: boolean;
  readonly holder?: string;
  readonly limit?: number;
};
export const STANDING_INVENTORY: InventoryKey = { standing: true };

export type ScreenRead = ExecutionAddress;

type Launch = {
  readonly operationId: string;
  readonly cwd: string;
  readonly program?: string;
  readonly args?: readonly string[];
  readonly label?: string;
  readonly env?: Readonly<Record<string, string | null>>;
  readonly lifetime: 'call' | 'held';
  readonly thread?: string;
};

export type StartInput =
  | (Launch & { readonly transport: 'pty'; readonly geometry?: { readonly rows: number; readonly columns: number } })
  | (Launch & { readonly transport: 'pipes'; readonly geometry?: never });

export type InputAct = { readonly _tag: 'Write'; readonly bytes: string } | { readonly _tag: 'Interrupt' };

export type InputInput = ExecutionAddress & {
  readonly binding: string;
  readonly sequence: number;
  readonly act: InputAct;
  readonly cause: 'typed' | 'paste' | 'raw' | 'mouse' | 'interrupt';
};

export type LaneOpenInput = ExecutionAddress & { readonly view: string };

export type LaneCloseInput = ExecutionAddress & { readonly binding: string };

export type TakeOverInput = ExecutionAddress & { readonly operationId: string };

export type SignalInput = ExecutionAddress & { readonly signal: string };

export type StopInput = ExecutionAddress & {
  readonly operationId: string;
  readonly cause: DeclaredCancellationCause;
};

export type CommandListKey = {
  readonly owner?: string;
  readonly standing?: boolean;
  readonly order?: CommandOrder;
  readonly after?: string;
  readonly limit: number;
};

export type CommandFeedKey = { readonly ended: number };

type Bare<Answer> = Answer extends unknown ? Omit<Answer, 'status'> : never;

const bare = <Answer extends { readonly status: string }>({ status: _status, ...rest }: Answer): Bare<Answer> => rest as Bare<Answer>;

const at = (address: ExecutionAddress) => ({
  execution: address.execution,
  incarnation: address.incarnation,
});

const byteWindow = (key: ByteWindow) => ({
  ...at(key),
  stream: key.stream,
  offset: key.offset,
  limit: key.limit,
  positions: key.positions === true,
});

export const ExecutionsRepo = Repo.define(
  'terminals',
  ({ single, keyed, mutation }) => ({
    inventory: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<InventoryKey>, door) => door.perform('read_terminals', key, { signal }),
    }),

    record: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<ExecutionAddress>, door) =>
        door.perform('read_terminal', at(key), { signal }).then(({ terminal, state }) => ({ record: terminal, state })),
    }),

    operation: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<string>, door) =>
        door.perform('read_terminal_operation', { operationId: key }, { signal }).then(({ operation }) => operation),
    }),

    bytes: keyed({
      gcTime: 0,
      loader: ({ key, signal }: KeyedLoaderContext<ByteWindow>, door) => door.perform('read_terminal_bytes', byteWindow(key), { signal }),
    }),

    screen: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<ScreenRead>, door) =>
        door.perform('read_terminal_screen', { ...at(key), cells: true }, { signal }).then(({ screen }) => screen),
    }),

    screenText: keyed({
      gcTime: 0,
      loader: ({ key, signal }: KeyedLoaderContext<ScreenRead>, door) =>
        door.perform('read_terminal_screen', at(key), { signal }).then(({ screen }) => screen),
    }),

    processes: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<ExecutionAddress>, door) => door.perform('read_terminal_processes', at(key), { signal }),
    }),

    start: mutation({
      mutator: (input: StartInput, { signal }, door) => door.perform('start_terminal', input, { signal }),
    }),

    wait: mutation({
      mutator: (input: ExecutionAddress & { readonly waitMs: number }, { signal }, door) =>
        door.perform('wait_terminal', { ...at(input), waitMs: input.waitMs }, { signal }).then(({ waited }) => waited),
    }),

    input: mutation({
      mutator: ({ execution, incarnation, ...payload }: InputInput, { signal }, door) =>
        door.perform('input_terminal', { execution, incarnation, ...payload }, { signal }).then((answered) => answered.answer),
    }),

    laneOpen: mutation({
      mutator: ({ execution, incarnation, ...payload }: LaneOpenInput, { signal }, door) =>
        door.perform('open_terminal_lane', { execution, incarnation, ...payload }, { signal }).then(bare),
    }),

    laneClose: mutation({
      mutator: ({ execution, incarnation, ...payload }: LaneCloseInput, { signal }, door) =>
        door.perform('close_terminal_lane', { execution, incarnation, ...payload }, { signal }).then(bare),
    }),

    takeOver: mutation({
      mutator: ({ execution, incarnation, ...payload }: TakeOverInput, { signal }, door) =>
        door.perform('take_over_terminal', { execution, incarnation, ...payload }, { signal }).then((answered) => answered.answer),
    }),

    signal: mutation({
      mutator: (input: SignalInput, { signal }, door) => door.perform('signal_terminal', input, { signal }).then(({ outcome }) => outcome),
    }),

    stop: mutation({
      mutator: (input: StopInput, { signal }, door) => door.perform('stop_terminal', input, { signal }).then(({ receipt }) => receipt),
    }),

    commands: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<CommandListKey>, door) => door.perform('read_commands', key, { signal }),
    }),

    commandFeed: keyed({
      gcTime: 0,
      loader: ({ key, signal }: KeyedLoaderContext<CommandFeedKey>, door) =>
        door.perform('read_command_feed', { ended: key.ended }, { signal }).then(bare),
    }),

    command: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<ExecutionAddress>, door) => door.perform('read_command', at(key), { signal }),
    }),

    commandBytes: keyed({
      gcTime: 0,
      loader: ({ key, signal }: KeyedLoaderContext<CommandByteWindow>, door) =>
        door.perform('read_command_bytes', { ...byteWindow(key), stream: key.stream }, { signal }),
    }),
  }),
  { tier: 'project', door: ProjectDoor },
);

type Repo = ReturnType<typeof ExecutionsRepo.use>;

type Refreshed<Q> = Q extends { readonly key: (key: never) => { readonly refresh: (...args: never[]) => Promise<infer A> } } ? A : never;

export type RecordReads = {
  readonly terminalBytes: (window: ByteWindow) => Promise<Refreshed<Repo['bytes']>>;
  readonly commandBytes: (window: CommandByteWindow) => Promise<Refreshed<Repo['commandBytes']>>;
  readonly terminal: (address: ExecutionAddress) => Promise<Refreshed<Repo['record']>>;
  readonly command: (address: ExecutionAddress) => Promise<Refreshed<Repo['command']>>;
};

export const repoReads = (repo: Repo): RecordReads => ({
  terminalBytes: (window) => repo.bytes.key(window).refresh({ throwOnError: true }),
  commandBytes: (window) => repo.commandBytes.key(window).refresh({ throwOnError: true }),
  terminal: (address) => repo.record.key(address).refresh({ throwOnError: true }),
  command: (address) => repo.command.key(address).refresh({ throwOnError: true }),
});

export const projectReads = (door: Door, projectId: number): RecordReads => {
  const lens = { project: String(projectId) };
  return {
    terminalBytes: (window) => door.perform('read_terminal_bytes', byteWindow(window), lens),
    commandBytes: (window) => door.perform('read_command_bytes', { ...byteWindow(window), stream: window.stream }, lens),
    terminal: (address) => door.perform('read_terminal', at(address), lens).then(({ terminal, state }) => ({ record: terminal, state })),
    command: (address) => door.perform('read_command', at(address), lens),
  };
};
