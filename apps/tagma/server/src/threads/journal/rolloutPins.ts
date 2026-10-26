import { createHash } from 'node:crypto';
import { rolloutStream } from './rolloutFile.js';
import type { ReadRollout } from '../contract/service/rolloutReads.js';
import { open, stat } from 'node:fs/promises';
import { createZstdDecompress } from 'node:zlib';

export async function rolloutCut(path: string, compressed: boolean, observe: ReadRollout): Promise<{ length: number; hash: string }> {
  const size = (await stat(path)).size;
  if (compressed) {
    const input = rolloutStream(path, observe);
    const stream = input.pipe(createZstdDecompress());
    input.on('error', (error) => stream.destroy(error));
    let hash = createHash('sha256');
    let last = '';
    let whole = true;
    try {
      for await (const part of stream) {
        const bytes = Buffer.from(part);
        let start = 0;
        for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
          hash.update(bytes.subarray(start, end + 1));
          last = hash.digest('hex');
          hash = createHash('sha256');
          start = end + 1;
        }
        hash.update(bytes.subarray(start));
        if (bytes.length > 0) whole = start === bytes.length;
      }
    } finally {
      input.destroy();
      stream.destroy();
    }
    if (!whole || last === '') throw new Error('the compressed rollout has no complete final record');
    return { length: size, hash: last };
  }
  const file = await open(path, 'r');
  const block = Buffer.alloc(64 * 1024);
  let end = -1;
  let start = 0;
  try {
    scan: for (let until = size; until > 0;) {
      const from = Math.max(0, until - block.length);
      const length = until - from;
      const read = await file.read(block, 0, length, from);
      observe({ path, bytes: read.bytesRead });
      if (read.bytesRead !== length) throw new Error('the rollout changed while its cut was read');
      for (let at = length - 1; at >= 0; at--) {
        if (block[at] !== 10) continue;
        if (end === -1) end = from + at + 1;
        else {
          start = from + at + 1;
          break scan;
        }
      }
      until = from;
    }
  } finally {
    await file.close();
  }
  if (end === -1) throw new Error('the rollout has no complete record');
  const hash = createHash('sha256');
  for await (const bytes of rolloutStream(path, observe, undefined, { start, end: end - 1 })) hash.update(bytes);
  return { length: end, hash: hash.digest('hex') };
}
