import { expect, test } from 'bun:test';
import { psUsage } from './ps';

test('the refused-process reader returns CPU and memory for a batch of processes', () => {
  const result = psUsage.read([process.pid, process.ppid]);
  for (const pid of [process.pid, process.ppid]) {
    const row = result.read.get(pid);
    expect(row?.micros).toBeGreaterThanOrEqual(0);
    expect(row?.residentBytes).toBeGreaterThan(0);
  }
});
