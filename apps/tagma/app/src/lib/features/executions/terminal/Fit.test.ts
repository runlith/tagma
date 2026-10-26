import { describe, expect, test } from 'vitest';
import type { Engine } from './terminalEngine.js';
import { TerminalFit, type FitFrames, type FitGrid } from './Fit.js';

function makeFrames() {
  const pending = new Map<number, () => void>();
  let seq = 1;
  const frames: FitFrames = {
    requestFrame: (callback) => {
      const id = seq++;
      pending.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      pending.delete(id);
    },
  };
  return {
    frames,
    drive(count: number): void {
      for (let i = 0; i < count; i++) {
        const next = pending.entries().next();
        if (next.done) return;
        const [id, callback] = next.value;
        pending.delete(id);
        callback();
      }
    },
  };
}

function makeHost(width: number, height: number) {
  const rect = { width, height };
  return { rect, element: { getBoundingClientRect: () => ({ ...rect }) } as unknown as Element };
}

function makeObserver() {
  let callback: (() => void) | null = null;
  return {
    factory: (seen: () => void) => {
      callback = seen;
      return { observe: () => undefined, disconnect: () => undefined };
    },
    trigger: () => {
      callback?.();
    },
  };
}

function makeEngine(propose: () => FitGrid | null | undefined, start: FitGrid = { cols: 80, rows: 24 }) {
  const terminal = { cols: start.cols, rows: start.rows };
  return { terminal, engine: { fit: { proposeDimensions: propose }, terminal } as unknown as Engine };
}

function setup(propose: () => FitGrid | null | undefined, onParked: () => void = () => undefined) {
  const frames = makeFrames();
  const observer = makeObserver();
  const engine = makeEngine(propose);
  const told: FitGrid[] = [];
  const fit = new TerminalFit(engine.engine, frames.frames, observer.factory, onParked, {
    measured: (box) => told.push(box),
  });
  const host = makeHost(800, 600);
  return { fit, frames, observer, engine, told, host };
}

describe('measuring the box', () => {
  test('every fit tells what the box measures, and the engine stays at the grid it was drawn at', () => {
    let proposal: FitGrid = { cols: 110, rows: 32 };
    const env = setup(() => proposal);
    env.fit.attach(env.host.element);
    env.frames.drive(1);
    proposal = { cols: 90, rows: 28 };
    env.fit.requestFit();
    env.frames.drive(4);

    expect(env.told).toEqual([
      { cols: 110, rows: 32 },
      { cols: 90, rows: 28 },
    ]);
    expect(env.engine.terminal.cols).toBe(80);
  });

  test('across a divider drag the measured box is told once, on release, at its last size', () => {
    let proposal: FitGrid = { cols: 100, rows: 30 };
    const env = setup(() => proposal);
    env.fit.attach(env.host.element);
    env.frames.drive(1);
    env.told.length = 0;

    const release = env.fit.hold();
    for (const cols of [101, 102, 103]) {
      proposal = { cols, rows: 30 };
      env.fit.requestFit();
      env.frames.drive(4);
    }
    expect(env.told).toEqual([]);
    release();
    expect(env.told).toEqual([{ cols: 103, rows: 30 }]);
  });
});

describe('stable-grid fit', () => {
  test('two agreeing proposals tell once', () => {
    let proposal: FitGrid | null = null;
    const env = setup(() => proposal);
    env.fit.attach(env.host.element);
    env.frames.drive(1);
    expect(env.told).toEqual([]);

    proposal = { cols: 100, rows: 30 };
    env.fit.requestFit();
    proposal = { cols: 110, rows: 32 };
    env.frames.drive(1);
    expect(env.told).toEqual([]);
    env.frames.drive(1);
    expect(env.told).toEqual([{ cols: 110, rows: 32 }]);
  });

  test('eight disagreeing frames tell at the eighth', () => {
    let n = 0;
    const env = setup(() => ({ cols: 100 + n++, rows: 24 }));
    env.fit.attach(env.host.element);
    env.frames.drive(1);
    const told = env.told.length;

    env.fit.requestFit();
    env.frames.drive(7);
    expect(env.told.length).toBe(told);
    env.frames.drive(1);
    expect(env.told.length).toBe(told + 1);
  });
});

describe('parked metrics', () => {
  test('a parked metric change applies before the first box is told', () => {
    const order: string[] = [];
    const env = setup(
      () => {
        order.push('proposed');
        return { cols: 100, rows: 30 };
      },
      () => order.push('parked'),
    );
    env.fit.attach(env.host.element);
    expect(order).toEqual([]);
    env.frames.drive(1);
    expect(order.indexOf('parked')).toBeGreaterThanOrEqual(0);
    expect(order.lastIndexOf('proposed')).toBeGreaterThan(order.indexOf('parked'));
    expect(env.told).toEqual([{ cols: 100, rows: 30 }]);
  });
});

describe('rebuild hold', () => {
  test('an observer fit asked during a rebuild hold runs once after release', () => {
    let proposal: FitGrid | null = null;
    const env = setup(() => proposal);
    env.fit.attach(env.host.element);
    env.frames.drive(1);

    proposal = { cols: 100, rows: 30 };
    const release = env.fit.holdForRebuild();
    env.observer.trigger();
    env.frames.drive(8);
    expect(env.told).toEqual([]);

    release();
    env.frames.drive(2);
    expect(env.told).toEqual([{ cols: 100, rows: 30 }]);
  });

  test('a detach drops the queued rebuild fit', () => {
    let proposal: FitGrid | null = null;
    const env = setup(() => proposal);
    env.fit.attach(env.host.element);
    env.frames.drive(1);

    proposal = { cols: 100, rows: 30 };
    const release = env.fit.holdForRebuild();
    env.observer.trigger();
    env.fit.detach();
    release();
    env.frames.drive(8);
    expect(env.told).toEqual([]);
  });
});
