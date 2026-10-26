/// <reference types="bun" />

import { dlopen, read } from 'bun:ffi';
import type { FlushAsk, FlushAnswer, FlushReady } from './flush.js';

declare const self: Worker;

const F_FULLFSYNC = 51;
const api = dlopen('libc.dylib', {
  fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
  __error: { args: [], returns: 'ptr' },
}).symbols;

self.addEventListener('message', (event: MessageEvent<FlushAsk>) => {
  const { id, fd } = event.data;
  try {
    const result = api.fcntl(fd, F_FULLFSYNC, 0);
    const reply: FlushAnswer = result === 0 ? { id, outcome: 'full' } : { id, outcome: 'errno', code: read.i32(api.__error() as never, 0) };
    self.postMessage(reply);
  } catch (cause) {
    self.postMessage({ id, outcome: 'error', reason: String(cause) } satisfies FlushAnswer);
  }
});
self.postMessage({ ready: true } satisfies FlushReady);
