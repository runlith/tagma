import { gcAndSweep } from 'bun:jsc';
import * as Effect from 'effect/Effect';
import { takeMemoryReading } from './MemoryReading.js';

const TARGETS = [0, 500_000, 2_000_000] as const;

const program = Effect.sync(() => {
  const held: Array<{ readonly index: number }> = [];
  console.log('held objects\theap objects\tcensus ms\tns/heap object');
  for (const target of TARGETS) {
    for (let index = held.length; index < target; index += 1) held.push({ index });
    gcAndSweep();
    const reading = takeMemoryReading('benchmark', 'all');
    const nanosecondsPerObject = (reading.censusMs * 1_000_000) / reading.heap.objectCount;
    console.log(
      `${target.toLocaleString()}\t${reading.heap.objectCount.toLocaleString()}\t${reading.censusMs.toFixed(3)}\t${nanosecondsPerObject.toFixed(2)}`,
    );
  }
  return held.length;
});

Effect.runSync(program);
