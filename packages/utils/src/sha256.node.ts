import { createHash, type Hash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { DigestEncoding, Sha256 } from './sha256';

export const sha256 = (): Sha256 => carried(createHash('sha256'));

function carried(running: Hash): Sha256 {
  const hash: Sha256 = {
    update: (data) => {
      running.update(data);
      return hash;
    },
    digest: (encoding: DigestEncoding) => running.digest(encoding),
    copy: () => carried(running.copy()),
  };
  return hash;
}

type Pending = { readonly resolve: (digests: readonly string[]) => void; readonly reject: (cause: unknown) => void };
type Lane = { readonly worker: Worker; readonly pending: Map<number, Pending>; next: number };
let lane: Lane | undefined;

const workerProgram = `
const { parentPort } = require('node:worker_threads');
const { createHash } = require('node:crypto');
parentPort.on('message', ({ id, parts }) => {
  const digests = parts.map((part) => createHash('sha256').update(part).digest('hex'));
  parentPort.postMessage({ id, digests });
});
`;

function hashingLane(): Lane {
  if (lane !== undefined) return lane;
  const worker = new Worker(workerProgram, { eval: true });
  const made: Lane = { worker, pending: new Map(), next: 0 };
  lane = made;
  const failed = (cause: unknown) => {
    if (lane === made) lane = undefined;
    for (const waiting of made.pending.values()) waiting.reject(cause);
    made.pending.clear();
    worker.unref();
  };
  worker.on('message', ({ id, digests }: { id: number; digests: readonly string[] }) => {
    const waiting = made.pending.get(id);
    if (waiting === undefined) return;
    made.pending.delete(id);
    waiting.resolve(digests);
    if (made.pending.size === 0) worker.unref();
  });
  worker.on('error', failed);
  worker.on('exit', (code) => failed(new Error(`SHA-256 worker ended with status ${code}`)));
  worker.unref();
  return made;
}

export function sha256Batch(parts: readonly Uint8Array[]): Promise<readonly string[]> {
  if (parts.length === 0) return Promise.resolve([]);
  const made = hashingLane();
  const id = made.next++;
  const copied = parts.map((part) => part.slice());
  return new Promise((resolve, reject) => {
    made.pending.set(id, { resolve, reject });
    made.worker.ref();
    try {
      made.worker.postMessage(
        { id, parts: copied },
        copied.map((part) => part.buffer),
      );
    } catch (cause) {
      made.pending.delete(id);
      if (made.pending.size === 0) made.worker.unref();
      reject(cause);
    }
  });
}
