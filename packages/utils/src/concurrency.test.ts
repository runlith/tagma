import { describe, expect, test } from 'bun:test';
import { ConcurrencyGate, mapConcurrent } from './concurrency.js';

describe('ConcurrencyGate', () => {
  test('bounds work submitted over time and preserves per-task results and failures', async () => {
    let inFlight = 0;
    let peak = 0;
    const { admit: limited } = new ConcurrencyGate(2);
    const task = (delay: number) =>
      limited(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, delay));
        inFlight -= 1;
        return delay;
      });
    const first = [task(5), task(1), task(4)];
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = [task(2), limited(async () => Promise.reject(new Error('boom')))];
    expect(await Promise.all(first)).toEqual([5, 1, 4]);
    expect(await first[0]).toBe(5);
    await expect(second[1]).rejects.toThrow('boom');
    expect(await second[0]).toBe(2);
    expect(peak).toBe(2);
  });

  test('a failed task releases its slot for queued work', async () => {
    const { admit: limited } = new ConcurrencyGate(1);
    const failed = limited(async () => Promise.reject(new Error('first')));
    const queued = limited(async () => 'ran');
    await expect(failed).rejects.toThrow('first');
    expect(await queued).toBe('ran');
  });

  test('a fresh caller racing a slot handover cannot push the gate past its limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const { admit: limited } = new ConcurrencyGate(1);
    const gauge = () =>
      limited(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
      });
    const running: Promise<void>[] = [gauge(), gauge()];
    for (let index = 0; index < 6; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      running.push(gauge());
    }
    await Promise.all(running);
    expect(peak).toBe(1);
  });

  test('a limit below one is refused rather than silently serialized', () => {
    expect(() => new ConcurrencyGate(0)).toThrow('at least 1');
    expect(() => {
      new ConcurrencyGate(2).limit = 0;
    }).toThrow('at least 1');
  });

  test('raising the ceiling admits queued work at once and holds the new bound', async () => {
    const gate = new ConcurrencyGate(1);
    const held = manualTasks(gate, 5);
    await tick();
    expect(held.started).toBe(1);

    gate.limit = 3;
    await tick();
    expect(held.started).toBe(3);
    expect(held.peak).toBe(3);

    held.finish(3);
    await tick();
    expect(held.started).toBe(5);
    expect(held.peak).toBe(3);
    await held.drain();
  });

  test('lowering the ceiling keeps running work and admits nothing until the count falls under it', async () => {
    const gate = new ConcurrencyGate(3);
    const held = manualTasks(gate, 5);
    await tick();
    expect(held.started).toBe(3);

    gate.limit = 1;
    await tick();
    expect(held.inFlight).toBe(3);
    expect(held.started).toBe(3);

    held.finish(2);
    await tick();
    expect(held.inFlight).toBe(1);
    expect(held.started).toBe(3);

    held.finish(1);
    await tick();
    expect(held.started).toBe(4);
    expect(held.inFlight).toBe(1);
    await held.drain();
  });
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function manualTasks(gate: ConcurrencyGate, count: number) {
  const releases: (() => void)[] = [];
  const counters = { started: 0, inFlight: 0, peak: 0 };
  const promises = Array.from({ length: count }, () =>
    gate.admit(async () => {
      counters.started += 1;
      counters.inFlight += 1;
      counters.peak = Math.max(counters.peak, counters.inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      counters.inFlight -= 1;
    }),
  );
  const all = Promise.all(promises);
  return {
    get started(): number {
      return counters.started;
    },
    get inFlight(): number {
      return counters.inFlight;
    },
    get peak(): number {
      return counters.peak;
    },
    finish: (n: number): void => {
      for (const release of releases.splice(0, n)) release();
    },
    drain: async (): Promise<void> => {
      while (counters.started < count || counters.inFlight > 0) {
        for (const release of releases.splice(0)) release();
        await tick();
      }
      await all;
    },
  };
}

describe('mapConcurrent', () => {
  test('never exceeds the limit and still returns results in input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapConcurrent([5, 1, 4, 2, 3], 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, item));
      inFlight -= 1;
      return item * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });

  test('a limit above the work list is not an error', async () => {
    expect(await mapConcurrent([1, 2], 10, async (item) => item)).toEqual([1, 2]);
    expect(await mapConcurrent([], 4, async (item) => item)).toEqual([]);
  });

  test('a limit below one is refused rather than silently serialized', () => {
    expect(mapConcurrent([1], 0, async (item) => item)).rejects.toThrow('at least 1');
  });
});
