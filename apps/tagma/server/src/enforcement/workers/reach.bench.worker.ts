import { parentPort, workerData } from 'node:worker_threads';
import { answer } from './inspecting.js';
import type { Posted } from './asks.js';

const ask = workerData as Posted;
let heap = 0;
const sample = () => {
  heap = Math.max(heap, process.memoryUsage().heapUsed);
};
sample();
const timer = setInterval(sample, 20);
try {
  const reply = await answer(ask, 'reach');
  sample();
  parentPort!.postMessage({ reply, heap });
} finally {
  clearInterval(timer);
}
