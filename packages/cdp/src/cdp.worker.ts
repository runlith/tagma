import { bytesText, type JobAnswer, type JobAsk, trimmed } from './jobs.js';

declare const self: Worker;

self.addEventListener('message', (event: MessageEvent<JobAsk>) => {
  const { id, job } = event.data;
  try {
    if (job.kind === 'bytes') {
      const bytes = bytesText(job.text);
      const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
      self.postMessage({ id, value: owned } satisfies JobAnswer, [owned.buffer as ArrayBuffer]);
      return;
    }
    const value = job.trim === null ? JSON.parse(job.text) : trimmed(JSON.parse(job.text), job.trim);
    self.postMessage({ id, value } satisfies JobAnswer);
  } catch (cause) {
    self.postMessage({ id, unreadable: String(cause) } satisfies JobAnswer);
  }
});
