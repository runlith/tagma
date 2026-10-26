import { executionHandshakeMs, OUTPUT_RETAINED_BYTES } from '../contract/wire/terminalBehavior.js';
import { totalmem } from 'node:os';
import { Schema } from 'effect';
import { ExecutionPolicy, grantOf, reserveOf } from '@runlith/executions/protocol/capacity';
import { WireLimits, frameSize, wireLimits } from '@runlith/executions/protocol/wire';

const KiB = 1024;
const MiB = 1024 * KiB;
const readers = 4;
const landingBytes = 16 * KiB;
const retainedBytes = OUTPUT_RETAINED_BYTES;
const readBytes = 64 * KiB;
const inputBytes = 64 * KiB;
const laneReceipts = (512 * KiB) / landingBytes;
const inputLanes = 4;
const inputReceipts = inputLanes * laneReceipts;
const parserPending = 256 * KiB;
const geometry = { columns: 320, rows: 100, scrollbackRows: 5000 };
const parsedLines = geometry.rows + geometry.scrollbackRows + geometry.rows;
const parserCells = 224 * MiB;
const frameBytes = 16 * MiB;
const receipts = 4096;

const memoryShare = 0.25;
const usageRoundMs = 60;
const usage = { periodMs: 20 * usageRoundMs };

export const executionPolicy = Schema.decodeUnknownSync(ExecutionPolicy)({
  transports: ['pipes', 'pty'],
  relations: ['leader'],
  execution: {
    input: { pendingBytes: inputBytes, chunkBytes: landingBytes, receipts: inputReceipts },
    output: { landingBytes, segmentBytes: 256 * KiB, retainedBytes },
    parser: { pendingBytes: parserPending, cellBytes: parserCells },
    geometry,
    read: { chunkBytes: readBytes, readerCredits: readBytes, readers },
    frame: { bytes: frameBytes, inFlight: 1 },
    receipts,
  },
  host: {
    bindings: receipts,
    custodyReceipts: receipts,
    tombstones: receipts,
  },
  usage,
});

export const executionGrant = grantOf(memoryShare, totalmem());

const fundedExecutions = Math.floor(executionGrant.grantBytes / reserveOf(executionPolicy.execution, 'pty'));

const envelopeBytes = 1 * MiB;
const recordHeaderBytes = 16 * KiB;

export const executionWireLimits = Schema.decodeUnknownSync(WireLimits)(
  wireLimits(executionPolicy, {
    envelopeBytes,
    connections: 6,
    requests: 6,
    subscriptions: fundedExecutions * readers,
    helloMs: executionHandshakeMs,
  }),
);

export const executionRecordWindow = 4;

export const executionRecordCredits = executionRecordWindow * frameSize(recordHeaderBytes, readBytes);

export const executionControlRequests = 2;
