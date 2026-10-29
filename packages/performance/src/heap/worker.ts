import { parentPort, workerData } from 'node:worker_threads';
import { InvalidSnapshot, readSnapshot } from './reader.ts';
import { ReportUnreadable, reportSummary } from './report.ts';
import type { HeapAnswer, HeapJob } from './wire.js';

const job: HeapJob = workerData;
let answer: HeapAnswer;
try {
  const summary = readSnapshot(job.file);
  answer = job.options === undefined ? { status: 'read', summary } : { status: 'report', report: reportSummary(summary, job.options) };
} catch (cause) {
  const message =
    cause instanceof InvalidSnapshot
      ? 'the file is not a supported V8 heap snapshot'
      : cause instanceof ReportUnreadable
        ? cause.message
        : 'the heap snapshot file could not be read';
  answer = { status: 'failed', message };
}
parentPort!.postMessage(answer);
parentPort!.close();
