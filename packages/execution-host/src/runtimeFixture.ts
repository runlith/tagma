import { Effect, Schema } from 'effect';
import { CapabilityProfile, TRANSFER_LIMIT, ceilingsOf } from '@runlith/executions/protocol/capacity';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { InputAnswer, InputRequest } from '@runlith/executions/protocol/input';
import type { Binding } from './Bindings';
import type { ExecutionInput, InputFenced } from './ExecutionInput';
import { fixtureMachine } from './hostFixture';

export const laneBinding = (principal = 'operator', lane = 'lane'): Binding => ({
  id: BindingId.make(`binding-${lane}-${principal}`),
  principal: Principal.make(principal),
  epoch: 1,
});

export const admit = (
  input: ExecutionInput,
  request: InputRequest,
  binding: Binding = laneBinding(),
): Effect.Effect<InputAnswer, InputFenced> => input.admit(request, binding);

const decodeProfile = Schema.decodeUnknownSync(CapabilityProfile);

const CELL_BYTES = 12;

const ENCODED_ROW_BYTES = 48;
const ENCODED_CELL_BYTES = 312;

const PARSE_BUFFER_PER_BYTE = 4;

const REFLOW_LAYOUTS = 2;
const DECORATION_BYTES = 48;
const LINK_SHARE = 16;
const CELL_TOTAL_BYTES = REFLOW_LAYOUTS * (CELL_BYTES + (DECORATION_BYTES * LINK_SHARE) / (LINK_SHARE - 1));

export const runtimeProfile = (
  options: {
    readonly executions?: number;
    readonly rows?: number;
    readonly columns?: number;
    readonly scrollbackRows?: number;
    readonly transports?: ReadonlyArray<'pipes' | 'pty'>;
    readonly inputPendingBytes?: number;
    readonly inputReceipts?: number;
    readonly receipts?: number;
    readonly payloadBytes?: number;
    readonly shutdownMs?: number;
  } = {},
): CapabilityProfile => {
  const executions = options.executions ?? 1;
  const rows = options.rows ?? 24;
  const columns = options.columns ?? 80;
  const scrollbackRows = options.scrollbackRows ?? 64;
  const landingBytes = TRANSFER_LIMIT;
  const segmentBytes = landingBytes * 2;
  const retainedBytes = segmentBytes + landingBytes * 2;
  const inputPending = options.inputPendingBytes ?? 4096;
  const inputChunk = Math.min(inputPending, 1024);
  const inputReceipts = options.inputReceipts ?? 4;
  const receipts = options.receipts ?? 8;
  const payloadBytes = options.payloadBytes ?? 8192;
  const parserPending = PARSE_BUFFER_PER_BYTE * landingBytes + payloadBytes * 2;
  const parserCells = Math.ceil((rows + scrollbackRows + rows) * columns * CELL_TOTAL_BYTES);
  const readers = 2;
  const readerCredits = landingBytes;
  const transports = options.transports ?? ['pipes', 'pty'];

  const policy = {
    transports,
    relations: ['leader'],
    execution: {
      input: { pendingBytes: inputPending, chunkBytes: inputChunk, receipts: inputReceipts },
      output: { landingBytes, segmentBytes, retainedBytes },
      parser: { pendingBytes: parserPending, cellBytes: parserCells },
      geometry: { columns, rows, scrollbackRows },
      read: { chunkBytes: landingBytes, readerCredits, readers },
      frame: {
        bytes: (rows + scrollbackRows) * (ENCODED_ROW_BYTES + columns * ENCODED_CELL_BYTES),
        inFlight: 1,
      },
      receipts,
    },
    host: { bindings: 8, custodyReceipts: 8, tombstones: 8 },
    shutdownMs: options.shutdownMs,
  } as const;
  const machine = fixtureMachine(policy, executions);

  return decodeProfile({
    version: 1,
    platform: { os: 'darwin', arch: process.arch },
    runtime: { name: 'bun', version: Bun.version },
    native: { crate: 'execution-platform', version: '0.1.0', build: 'runtime-fixture' },
    ...policy,
    granted: machine.granted,
    ceilings: ceilingsOf(policy, machine),
  });
};
