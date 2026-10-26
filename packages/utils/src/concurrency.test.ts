import { describe, expect, test } from 'bun:test';
import { createDeferred } from './async.js';
import { ConcurrencyGate, mapConcurrent } from './concurrency.js';

describe('ConcurrencyGate', () => {
  test('bounds work submitted over time and preserves per-task results and failures', async () => {
    let inFlight = 0;
    let peak = 0;
    const { admit: limited } = new ConcurrencyGate(2);
    const releases = Array.from({ length: 4 }, () => createDeferred<void>());
    const task = (value: number, index: number) =>
      limited(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await releases[index]!.promise;
        inFlight -= 1;
        return value;
      });
    const first = [task(5, 0), task(1, 1), task(4, 2)];
    releases[1]!.resolve();
    expect(await first[1]).toBe(1);
    const second = [task(2, 3), limited(async () => Promise.reject(new Error('boom')))];
    for (const release of releases) release.resolve();
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
    const finishing = createDeferred<void>();
    const release = createDeferred<void>();
    const completed = finishing.promise.then(() => {
      inFlight -= 1;
    });
    const first = limited(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return completed;
    });
    const gauge = () =>
      limited(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await release.promise;
        inFlight -= 1;
      });
    const queued = gauge();
    const racing = completed.then(gauge);
    finishing.resolve();
    await first;
    release.resolve();
    await Promise.all([queued, racing]);
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
    expect(held.started).toBe(1);

    gate.limit = 3;
    await held.startedAt(3);
    expect(held.started).toBe(3);
    expect(held.peak).toBe(3);

    await held.finish(3);
    await held.startedAt(5);
    expect(held.started).toBe(5);
    expect(held.peak).toBe(3);
    await held.drain();
  });

  test('lowering the ceiling keeps running work and admits nothing until the count falls under it', async () => {
    const gate = new ConcurrencyGate(3);
    const held = manualTasks(gate, 5);
    expect(held.started).toBe(3);

    gate.limit = 1;
    expect(held.inFlight).toBe(3);
    expect(held.started).toBe(3);

    await held.finish(2);
    expect(held.inFlight).toBe(1);
    expect(held.started).toBe(3);

    await held.finish(1);
    await held.startedAt(4);
    expect(held.started).toBe(4);
    expect(held.inFlight).toBe(1);
    await held.drain();
  });
});

function manualTasks(gate: ConcurrencyGate, count: number) {
  const releases: { release: () => void; index: number }[] = [];
  const starts = Array.from({ length: count }, () => createDeferred<void>());
  const counters = { started: 0, inFlight: 0, peak: 0 };
  const promises = Array.from({ length: count }, (_unused, index) =>
    gate.admit(async () => {
      counters.started += 1;
      counters.inFlight += 1;
      counters.peak = Math.max(counters.peak, counters.inFlight);
      starts[counters.started - 1]!.resolve();
      await new Promise<void>((release) => releases.push({ release, index }));
      counters.inFlight -= 1;
    }),
  );
  const finish = async (n: number): Promise<void> => {
    const finishing = releases.splice(0, n);
    for (const task of finishing) task.release();
    await Promise.all(finishing.map((task) => promises[task.index]));
  };
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
    startedAt: (n: number): Promise<void> => starts[n - 1]!.promise,
    finish,
    drain: async (): Promise<void> => {
      while (counters.inFlight > 0) await finish(releases.length);
      await all;
    },
  };
}

describe('mapConcurrent', () => {
  test('never exceeds the limit and still returns results in input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const releases = Array.from({ length: 5 }, () => createDeferred<void>());
    const starts = Array.from({ length: 5 }, () => createDeferred<void>());
    const results = mapConcurrent([5, 1, 4, 2, 3], 2, async (item, index) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      starts[index]!.resolve();
      await releases[index]!.promise;
      inFlight -= 1;
      return item * 10;
    });
    for (const index of [1, 2, 3, 4, 0]) {
      await starts[index]!.promise;
      releases[index]!.resolve();
    }
    expect(await results).toEqual([50, 10, 40, 20, 30]);
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
