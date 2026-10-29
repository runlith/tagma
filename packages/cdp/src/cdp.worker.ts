import { bytesText, chunkText, type JobAnswer, type JobAsk, trimmed } from './jobs.js';

declare const self: Worker;

const owned = (bytes: Uint8Array): Uint8Array =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();

self.addEventListener('message', (event: MessageEvent<JobAsk>) => {
  const { id, job } = event.data;
  try {
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
    self.postMessage({ id, unreadable: String(cause) } satisfies JobAnswer);
  }
});
