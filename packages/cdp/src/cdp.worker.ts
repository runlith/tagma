import { appendFileSync } from 'node:fs';
import { Schema } from 'effect';
import { bytesText, chunkText, type JobAnswer, type JobAsk, trimmed } from './jobs.js';

const heapChunk = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({ params: Schema.Struct({ chunk: Schema.String }) })));

declare const self: Worker;

const owned = (bytes: Uint8Array): Uint8Array =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();

self.addEventListener('message', (event: MessageEvent<JobAsk>) => {
  const { id, job } = event.data;
  try {
    if (job.kind === 'heap') {
      const decoded = heapChunk(job.text);
      if (decoded._tag === 'Failure') {
        self.postMessage({ id, unreadable: 'the heap chunk was unreadable' } satisfies JobAnswer);
        return;
      }
      appendFileSync(job.file, decoded.success.params.chunk, { encoding: 'utf8' });
      self.postMessage({ id, value: null } satisfies JobAnswer);
      return;
    }
    if (job.kind === 'bytes') {
      const bytes = owned(bytesText(job.text));
      self.postMessage({ id, value: bytes } satisfies JobAnswer, [bytes.buffer as ArrayBuffer]);
      return;
    }
    if (job.kind === 'chunk') {
      const chunk = chunkText(job.text);
      const bytes = owned(chunk.bytes);
      self.postMessage({ id, value: { bytes, eof: chunk.eof } } satisfies JobAnswer, [bytes.buffer as ArrayBuffer]);
      return;
    }
    const value = job.trim === null ? JSON.parse(job.text) : trimmed(JSON.parse(job.text), job.trim);
    self.postMessage({ id, value } satisfies JobAnswer);
  } catch (cause) {
    self.postMessage({
      id,
      unreadable:
        job.kind === 'heap' ? `the heap chunk was not written: ${cause instanceof Error ? cause.name : 'write failure'}` : String(cause),
    } satisfies JobAnswer);
  }
});
