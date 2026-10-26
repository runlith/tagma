import { Host } from '@runlith/layer/Host';
import type { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';
import { describe, expect, test } from 'vitest';
import { TerminalRenderer } from './Renderer.js';
import { TerminalRenderPolicy, type RenderClock, type RenderMode, type RendererReading } from './RenderPolicy.js';

function makeClock() {
  const frames = new Map<number, () => void>();
  const timers: { id: number; at: number; run: () => void }[] = [];
  let seq = 1;
  let time = 1_000;
  const clock: RenderClock = {
    requestFrame: (callback) => {
      const id = seq++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
    delay: (callback, ms) => {
      const id = seq++;
      timers.push({ id, at: time + ms, run: callback });
      return id;
    },
    now: () => time,
  };
  return {
    clock,
    pending: () => frames.size,
    drive(count = 1): void {
      for (let index = 0; index < count; index++) {
        const batch = [...frames.values()];
        frames.clear();
        for (const callback of batch) callback();
      }
    },
    advance(ms: number): void {
      time += ms;
      for (const timer of [...timers]) {
        if (timer.at > time) continue;
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
    },
  };
}

function makeElement(display: () => string): HTMLElement {
  return {
    parentElement: null,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ display: display() }) } },
  } as unknown as HTMLElement;
}

function makeTerminal(options: { rows?: number; element?: HTMLElement; core?: unknown; log?: string[] } = {}) {
  const calls = { refresh: [] as [number, number][], blurred: 0, addons: [] as unknown[] };
  const terminal = {
    rows: options.rows ?? 24,
    cols: 80,
    element: options.element,
    refresh: (start: number, end: number) => {
      calls.refresh.push([start, end]);
      options.log?.push(`refresh:${start}-${end}`);
    },
    blur: () => {
      calls.blurred += 1;
    },
    loadAddon: (addon: unknown) => {
      calls.addons.push(addon);
    },
    ...(options.core === undefined ? {} : (options.core as object)),
  };
  return { calls, terminal: terminal as unknown as Terminal };
}

function makeAddon(name = 'pane', log?: string[]) {
  const gl = {
    lost: false,
    releases: 0,
    isContextLost: () => gl.lost,
    getExtension: (extension: string) =>
      extension === 'WEBGL_lose_context'
        ? {
            loseContext: () => {
              gl.releases += 1;
              gl.lost = true;
            },
          }
        : null,
  };
  const canvas = { width: 300, height: 150 };
  const state = { disposed: false, wipes: 0 };
  let handler: (() => void) | null = null;
  const addon = {
    _renderer: { _gl: gl, _canvas: canvas },
    onContextLoss: (next: () => void) => {
      handler = next;
      return {
        dispose: () => {
          handler = null;
        },
      };
    },
    clearTextureAtlas: () => {
      state.wipes += 1;
      log?.push(`wipe:${name}`);
    },
    dispose: () => {
      state.disposed = true;
    },
    activate: () => undefined,
  };
  return { addon: addon as unknown as WebglAddon, gl, canvas, state, lose: () => handler?.() };
}

function makeFactory(log?: string[]) {
  const built: ReturnType<typeof makeAddon>[] = [];
  return {
    built,
    latest: () => built[built.length - 1] as ReturnType<typeof makeAddon>,
    factory: (): WebglAddon => {
      const made = makeAddon(`pane${built.length}`, log);
      built.push(made);
      return made.addon;
    },
  };
}

function makePolicy(mode: () => RenderMode = () => 'auto', clock: RenderClock = makeClock().clock) {
  const reading: RendererReading = { webgl2: true, renderer: 'Apple M3', vendor: 'Apple', displayServer: null };
  return new TerminalRenderPolicy(new Host('desktop', 'macos'), () => reading, clock, mode);
}

function makeRenderer(
  options: {
    clock?: ReturnType<typeof makeClock>;
    terminal?: ReturnType<typeof makeTerminal>;
    factory?: ReturnType<typeof makeFactory>;
    mode?: () => RenderMode;
    open?: boolean;
  } = {},
) {
  const clock = options.clock ?? makeClock();
  const terminal = options.terminal ?? makeTerminal();
  const factory = options.factory ?? makeFactory();
  const policy = makePolicy(options.mode ?? (() => 'auto'), clock.clock);
  const refits = { count: 0 };
  const renderer = new TerminalRenderer(policy, factory.factory, clock.clock, () => {
    refits.count += 1;
  });
  if (options.open !== false) renderer.open(terminal.terminal);
  return { clock, terminal, factory, policy, refits, renderer };
}

describe('context loss', () => {
  test('a third loss inside the window keeps the pane on the DOM renderer until the window passes', () => {
    const { clock, factory, renderer } = makeRenderer();

    for (let loss = 1; loss <= 2; loss++) {
      factory.latest().lose();
      expect(renderer.attached).toBe(false);
      renderer.reattach();
      expect(renderer.attached).toBe(true);
    }

    factory.latest().lose();
    renderer.reattach();
    expect(renderer.attached).toBe(false);
    renderer.reattach();
    expect(renderer.attached).toBe(false);

    clock.advance(60_001);
    renderer.reattach();
    expect(renderer.attached).toBe(true);
  });

  test('disposing loses the GL context and zeroes the canvas, so a tab switch never meets the context budget', () => {
    const { factory, renderer } = makeRenderer();
    const attachment = factory.latest();

    renderer.dispose();

    expect(attachment.gl.releases).toBe(1);
    expect(attachment.canvas).toEqual({ width: 0, height: 0 });
    expect(attachment.state.disposed).toBe(true);
  });
});

describe('attach latch', () => {
  test('a failed attach holds that pane on DOM until a recovery boundary, whatever the page allows', () => {
    const clock = makeClock();
    const terminal = makeTerminal();
    const working = makeFactory();
    let refuse = true;
    const factory = {
      ...working,
      factory: (): WebglAddon => {
        if (refuse) throw new Error('WebGL unavailable');
        return working.factory();
      },
    };
    const { renderer } = makeRenderer({ clock, terminal, factory, mode: () => 'on' });

    expect(renderer.attached).toBe(false);

    refuse = false;
    renderer.attach();
    expect(renderer.attached).toBe(false);

    renderer.resume();
    expect(renderer.attached).toBe(true);
  });

  test('a failed attach under auto keeps the rest of the page on DOM too', () => {
    const failing = {
      factory: (): WebglAddon => {
        throw new Error('WebGL unavailable');
      },
    } as ReturnType<typeof makeFactory>;
    const { policy } = makeRenderer({ factory: failing });

    expect(policy.allowsWebgl()).toBe(false);
  });
});

describe('reparent', () => {
  test('a reparent releases the context and takes a new one on the next frame', () => {
    const { clock, factory, renderer } = makeRenderer();
    const before = factory.latest();

    renderer.disposeForReparent();

    expect(renderer.attached).toBe(false);
    expect(before.gl.releases).toBe(1);

    clock.drive();

    expect(renderer.attached).toBe(true);
    expect(factory.built).toHaveLength(2);
  });
});

describe('presenting', () => {
  test('an engine without xterm internals degrades to a full-viewport refresh', () => {
    const { terminal, renderer } = makeRenderer({ terminal: makeTerminal({ rows: 24 }) });
    terminal.calls.refresh.length = 0;

    renderer.present();

    expect(terminal.calls.refresh).toEqual([[0, 23]]);
  });

  test('a paused render service is driven through one synchronous full-row present with the latch cleared', () => {
    const log: string[] = [];
    const service = {
      _isPaused: true,
      _needsFullRefresh: true,
      refreshRows: (start: number, end: number, sync?: boolean) => {
        log.push(`refreshRows:${start}-${end}:${sync === true}`);
      },
      _renderer: null,
    };
    const terminal = makeTerminal({ rows: 10, core: { _core: { _renderService: service } } });
    const { renderer } = makeRenderer({ terminal });
    terminal.calls.refresh.length = 0;

    renderer.present();

    expect(log).toEqual(['refreshRows:0-9:true']);
    expect(service._isPaused).toBe(false);
    expect(service._needsFullRefresh).toBe(false);
    expect(terminal.calls.refresh).toEqual([]);
  });

  test('a synchronized-output frame is published through the renderer, and preserved when the caller asks', () => {
    const log: string[] = [];
    const service = {
      _isPaused: false,
      _needsFullRefresh: false,
      refreshRows: (start: number, end: number, sync?: boolean) => {
        log.push(`refreshRows:${start}-${end}:${sync === true}`);
      },
      _renderer: {
        value: {
          renderRows: (start: number, end: number) => {
            log.push(`renderRows:${start}-${end}`);
          },
        },
      },
    };
    const terminal = makeTerminal({
      rows: 10,
      core: { _core: { _renderService: service, coreService: { decPrivateModes: { synchronizedOutput: true } } } },
    });
    const { renderer } = makeRenderer({ terminal });

    renderer.present();
    expect(log).toEqual(['renderRows:0-9']);

    renderer.presentPreservingFrame();
    expect(log).toEqual(['renderRows:0-9', 'refreshRows:0-9:true']);
  });

  test('a pane with no box retries for sixteen frames and then latches', () => {
    let display = 'none';
    const terminal = makeTerminal({ rows: 5, element: makeElement(() => display) });
    const { clock, renderer } = makeRenderer({ terminal });
    terminal.calls.refresh.length = 0;

    renderer.present();
    expect(terminal.calls.refresh).toEqual([[0, 4]]);

    clock.drive(16);
    expect(clock.pending()).toBe(0);
    expect(terminal.calls.refresh).toEqual([[0, 4]]);

    renderer.present();
    display = 'block';
    clock.drive();
    expect(terminal.calls.refresh).toEqual([
      [0, 4],
      [0, 4],
      [0, 4],
    ]);
  });
});

describe('fit and device pixels', () => {
  test('a fit on a WebGL-eligible pane stuck on DOM attaches and then asks for a refit', () => {
    const { clock, factory, refits, renderer } = makeRenderer({ open: false });
    const terminal = makeTerminal();
    renderer.open(terminal.terminal);
    renderer.dispose();
    expect(renderer.attached).toBe(false);

    renderer.afterFit();

    expect(renderer.attached).toBe(true);
    expect(factory.built).toHaveLength(2);
    expect(refits.count).toBe(0);
    clock.drive();
    expect(refits.count).toBe(1);
  });

  test('a backing store left at another display pixel ratio is repaired through xterm own resize path', () => {
    const order: string[] = [];
    const view = { devicePixelRatio: 1 };
    const canvas = { width: 2160, height: 1200, isConnected: true, ownerDocument: { defaultView: view } };
    const renderer = {
      _canvas: canvas,
      _devicePixelRatio: 2,
      dimensions: { device: { canvas: { width: 1080, height: 600 } } },
      handleDevicePixelRatioChange: () => order.push('ratio'),
      handleResize: (cols: number, rows: number) => order.push(`resize:${cols}x${rows}`),
    };
    const terminal = makeTerminal({ rows: 24, core: { _core: { _renderService: { _renderer: { value: renderer } } } } });
    const pane = makeRenderer({ terminal });
    terminal.calls.refresh.length = 0;

    expect(pane.renderer.repairDpr()).toBe('repaired');
    expect(order).toEqual(['ratio', 'resize:80x24']);
    expect(terminal.calls.refresh).toEqual([[0, 23]]);

    renderer._devicePixelRatio = 1;
    canvas.width = 1080;
    canvas.height = 600;
    expect(pane.renderer.repairDpr()).toBe('current');

    canvas.isConnected = false;
    expect(pane.renderer.repairDpr()).toBe('deferred');
  });
});

describe('hidden panes', () => {
  test('a rebuild behind a hidden pane waits for its reveal', () => {
    const { factory, renderer } = makeRenderer();
    renderer.suspend();

    renderer.rebuild();

    expect(factory.built).toHaveLength(1);
    expect(renderer.attached).toBe(true);

    renderer.resume();

    expect(factory.built).toHaveLength(2);
    expect(renderer.attached).toBe(true);
  });

  test('a context lost behind the hide is dropped on resume and taken again', () => {
    const { factory, renderer } = makeRenderer();
    const attachment = factory.latest();
    renderer.suspend();
    attachment.gl.lost = true;

    renderer.resume();

    expect(factory.built).toHaveLength(2);
    expect(renderer.attached).toBe(true);
  });
});
