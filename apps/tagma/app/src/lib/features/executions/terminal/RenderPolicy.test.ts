import { Host, type HostOs } from '@runlith/layer/Host';
import type { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';
import { describe, expect, test, vi } from 'vitest';
import { TerminalRenderer } from './Renderer.js';
import {
  TerminalRenderPolicy,
  type DisplayReading,
  type PageNotices,
  type PagePane,
  type RenderClock,
  type RenderMode,
  type RendererReading,
  type VisibilityReading,
} from './RenderPolicy.js';

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

const HARDWARE: RendererReading = {
  webgl2: true,
  renderer: 'AMD Radeon RX 7600 (radeonsi)',
  vendor: 'AMD',
  displayServer: 'x11',
};

function makePolicy(
  options: {
    os?: HostOs;
    reading?: () => RendererReading;
    mode?: () => RenderMode;
    clock?: RenderClock;
    visibility?: VisibilityReading;
  } = {},
) {
  const read = options.reading ?? (() => HARDWARE);
  return new TerminalRenderPolicy(
    new Host('desktop', options.os ?? 'linux'),
    () => read(),
    options.clock ?? makeClock().clock,
    options.mode ?? (() => 'auto'),
    options.visibility ?? makeVisibility().visibility,
  );
}

function makeAddon(name: string, log: string[]) {
  const gl = {
    lost: false,
    isContextLost: () => gl.lost,
    getExtension: (extension: string) => (extension === 'WEBGL_lose_context' ? { loseContext: () => undefined } : null),
  };
  const addon = {
    _renderer: { _gl: gl, _canvas: { width: 300, height: 150 } },
    onContextLoss: () => ({ dispose: () => undefined }),
    clearTextureAtlas: () => log.push(`wipe:${name}`),
    dispose: () => undefined,
    activate: () => undefined,
  };
  return addon as unknown as WebglAddon;
}

function makePane(name: string, log: string[], policy: TerminalRenderPolicy, clock: RenderClock) {
  const terminal = {
    rows: 24,
    cols: 80,
    element: undefined,
    refresh: () => log.push(`present:${name}`),
    blur: () => undefined,
    loadAddon: () => undefined,
  } as unknown as Terminal;
  const renderer = new TerminalRenderer(
    policy,
    () => makeAddon(name, log),
    clock,
    () => undefined,
  );
  renderer.open(terminal);
  const leave = policy.join(renderer);
  return { renderer, leave };
}

describe('the platform verdict', () => {
  test('a software renderer refuses the GPU, and the reading is taken once for the page', () => {
    let identity = 'llvmpipe (LLVM 17.0.6, 256 bits)';
    const policy = makePolicy({ reading: () => ({ ...HARDWARE, renderer: identity }) });

    expect(policy.verdict()).toMatchObject({ allowed: false, reason: 'linux-software-renderer' });
    expect(policy.allowsWebgl()).toBe(false);

    identity = 'AMD Radeon RX 7600 (radeonsi)';
    expect(policy.verdict().allowed).toBe(false);

    policy.reconsider();
    expect(policy.verdict()).toMatchObject({ allowed: true, reason: 'linux-hardware-renderer' });
  });

  test('each Linux ground refuses on its own, and everything else is allowed', () => {
    expect(makePolicy({ reading: () => ({ ...HARDWARE, displayServer: 'wayland' }) }).verdict()).toMatchObject({
      allowed: false,
      reason: 'linux-wayland',
    });
    expect(makePolicy({ reading: () => ({ ...HARDWARE, webgl2: false }) }).verdict()).toMatchObject({
      allowed: false,
      reason: 'linux-webgl2-unavailable',
    });
    expect(makePolicy({ reading: () => ({ ...HARDWARE, renderer: null, vendor: null }) }).verdict()).toMatchObject({
      allowed: false,
      reason: 'linux-renderer-unavailable',
    });
    expect(makePolicy().verdict()).toMatchObject({ allowed: true, reason: 'linux-hardware-renderer' });

    const elsewhere = makePolicy({ os: 'macos', reading: () => ({ ...HARDWARE, webgl2: false }) });
    expect(elsewhere.verdict()).toMatchObject({ allowed: true, reason: 'non-linux' });
    expect(makePolicy({ os: 'unknown', reading: () => ({ ...HARDWARE, webgl2: false }) }).verdict().allowed).toBe(true);
  });

  test('the setting overrides the platform, and a failed attach only suggests DOM under auto', () => {
    const refusing = () => ({ ...HARDWARE, renderer: 'llvmpipe' });
    expect(makePolicy({ reading: refusing, mode: () => 'on' }).allowsWebgl()).toBe(true);
    expect(makePolicy({ mode: () => 'off' }).allowsWebgl()).toBe(false);

    const auto = makePolicy();
    auto.suggestDom();
    expect(auto.allowsWebgl()).toBe(false);

    const on = makePolicy({ mode: () => 'on' });
    on.suggestDom();
    expect(on.allowsWebgl()).toBe(true);
  });
});

describe('the shared glyph atlas', () => {
  test('every live pane is wiped before any pane presents', () => {
    const log: string[] = [];
    const clock = makeClock();
    const policy = makePolicy({ os: 'macos', clock: clock.clock });
    makePane('a', log, policy, clock.clock);
    makePane('b', log, policy, clock.clock);
    log.length = 0;

    policy.recover();

    expect(log).toEqual(['wipe:a', 'wipe:b', 'present:a', 'present:b']);
  });

  test('a hidden pane is skipped, so recovery never revives the context it just released', () => {
    const log: string[] = [];
    const clock = makeClock();
    const policy = makePolicy({ os: 'macos', clock: clock.clock });
    const visible = makePane('a', log, policy, clock.clock);
    const hidden = makePane('b', log, policy, clock.clock);
    const gone = makePane('c', log, policy, clock.clock);
    hidden.renderer.suspend();
    gone.renderer.destroy();
    log.length = 0;

    policy.recover();

    expect(log).toEqual(['wipe:a', 'present:a']);
    expect(visible.renderer.attached).toBe(true);
  });

  test('a reveal repaints two frames after layout, once for every pane it reaches', () => {
    const log: string[] = [];
    const clock = makeClock();
    const policy = makePolicy({ os: 'macos', clock: clock.clock });
    const pane = makePane('a', log, policy, clock.clock);
    makePane('b', log, policy, clock.clock);
    pane.renderer.dispose();
    log.length = 0;

    policy.scheduleReveal();
    policy.scheduleReveal();

    clock.drive();
    expect(log).toEqual([]);

    clock.drive();

    expect(pane.renderer.attached).toBe(true);
    expect(log).toEqual(['present:a', 'wipe:a', 'wipe:b', 'present:a', 'present:b']);
  });

  test('a woken page presents again at 120 ms and at 500 ms', () => {
    const log: string[] = [];
    const clock = makeClock();
    const policy = makePolicy({ os: 'macos', clock: clock.clock });
    makePane('a', log, policy, clock.clock);

    policy.wake();
    clock.drive(2);
    log.length = 0;

    clock.advance(119);
    expect(log).toEqual([]);

    clock.advance(1);
    expect(log).toEqual(['present:a']);

    clock.advance(380);
    expect(log).toEqual(['present:a', 'present:a']);
  });
});

describe('hidden retention', () => {
  test('six hidden owners keep their contexts and the seventh evicts the oldest', () => {
    const log: string[] = [];
    const clock = makeClock();
    const policy = makePolicy({ os: 'macos', clock: clock.clock });
    const tabs = Array.from({ length: 7 }, (_, index) => {
      const owner = { tab: index };
      const pane = makePane(`t${index}`, log, policy, clock.clock);
      return { owner, pane };
    });

    for (const tab of tabs.slice(0, 6)) policy.suspend(tab.owner, () => [tab.pane.renderer]);

    expect(tabs.slice(0, 6).every((tab) => tab.pane.renderer.attached)).toBe(true);
    expect(policy.retained).toBe(6);

    const seventh = tabs[6] as (typeof tabs)[number];
    policy.suspend(seventh.owner, () => [seventh.pane.renderer]);

    expect((tabs[0] as (typeof tabs)[number]).pane.renderer.attached).toBe(false);
    expect(seventh.pane.renderer.attached).toBe(true);
    expect(tabs.slice(1).every((tab) => tab.pane.renderer.attached)).toBe(true);
    expect(policy.retained).toBe(6);
  });

  test('an owner wider than the whole budget is disposed instead of evicting every other tab', () => {
    const log: string[] = [];
    const clock = makeClock();
    const policy = makePolicy({ os: 'macos', clock: clock.clock });
    const kept = { tab: 'kept' };
    const keptPane = makePane('kept', log, policy, clock.clock);
    policy.suspend(kept, () => [keptPane.renderer]);

    const wide = { tab: 'wide' };
    const panes = Array.from({ length: 7 }, (_, index) => makePane(`w${index}`, log, policy, clock.clock));
    policy.suspend(wide, () => panes.map((pane) => pane.renderer));

    expect(panes.every((pane) => pane.renderer.attached)).toBe(false);
    expect(keptPane.renderer.attached).toBe(true);
    expect(policy.retained).toBe(1);

    policy.resume(kept, () => [keptPane.renderer]);
    expect(policy.retained).toBe(0);
  });

  test('growth of a hidden engine rejudges its budget without making it the newest hidden pane', () => {
    const policy = makePolicy();
    const parked: string[] = [];
    let bytes = 1;
    const oldest = { heldBytes: () => 1, park: () => parked.push('oldest') };
    const growing = { heldBytes: () => bytes, park: () => parked.push('growing') };
    policy.hide(oldest);
    policy.hide(growing);
    bytes = 64 * 1024 * 1024;
    policy.changed(growing);
    expect(parked).toEqual(['oldest']);
  });

  test('a hidden terminal past the engine budget gives up its engine, the longest hidden first, and one shown again is never taken', () => {
    const policy = makePolicy();
    const parked: string[] = [];
    const hidden = (name: string, bytes: number) => ({ heldBytes: () => bytes, park: () => void parked.push(name) });
    const small = hidden('small', 1);
    const shown = hidden('shown', 1);
    policy.hide(small);
    policy.hide(shown);
    policy.unhide(shown);
    policy.hide(hidden('huge', 2 ** 40));
    expect(parked).toEqual(['small', 'huge']);
  });
});

function makeDprPane(name: string, log: string[], policy: TerminalRenderPolicy, clock: RenderClock) {
  const view = { devicePixelRatio: 2 };
  const canvas = { width: 2160, height: 1200, isConnected: true, ownerDocument: { defaultView: view } };
  const engine = {
    _canvas: canvas,
    _devicePixelRatio: 2,
    dimensions: { device: { canvas: { width: 1080, height: 600 } } },
    handleDevicePixelRatioChange: () => log.push(`ratio:${name}`),
    handleResize: () => log.push(`resize:${name}`),
  };
  const terminal = {
    rows: 24,
    cols: 80,
    element: undefined,
    refresh: () => log.push(`present:${name}`),
    blur: () => undefined,
    loadAddon: () => undefined,
    _core: { _renderService: { _renderer: { value: engine } } },
  } as unknown as Terminal;
  const renderer = new TerminalRenderer(
    policy,
    () => makeAddon(name, log),
    clock,
    () => undefined,
  );
  renderer.open(terminal);
  policy.join(renderer);
  return {
    renderer,
    canvas,
    moveDisplay: (ratio: number) => {
      view.devicePixelRatio = ratio;
    },
  };
}

function makeDisplay(ratio = 2) {
  const listeners: (() => void)[] = [];
  const display: DisplayReading = {
    ratio: () => ratio,
    watch: (moved) => {
      listeners.push(moved);
      return () => {
        listeners.splice(listeners.indexOf(moved), 1);
      };
    },
  };
  return {
    display,
    set: (next: number) => {
      ratio = next;
    },
    notice: () => {
      for (const moved of [...listeners]) moved();
    },
    watchers: () => listeners.length,
  };
}

describe('a display that moved under the panes', () => {
  test('a ratio change repairs every live pane and presents it, and a pane with no box yet is chased by frames', () => {
    const log: string[] = [];
    const clock = makeClock();
    const policy = makePolicy({ os: 'macos', clock: clock.clock });
    const pane = makeDprPane('a', log, policy, clock.clock);
    const display = makeDisplay(2);
    const release = policy.watchDisplay(display.display);
    pane.canvas.isConnected = false;
    log.length = 0;

    display.set(1);
    pane.moveDisplay(1);
    display.notice();

    expect(log).toEqual([]);
    pane.canvas.isConnected = true;
    clock.drive();
    expect(log.slice(0, 2)).toEqual(['ratio:a', 'resize:a']);
    expect(log).toContain('present:a');

    log.length = 0;
    display.notice();
    expect(log).toEqual([]);

    release();
    expect(display.watchers()).toBe(0);
  });

  test('a reveal and a wake each repair a backing store left at another ratio', () => {
    const log: string[] = [];
    const clock = makeClock();
    const policy = makePolicy({ os: 'macos', clock: clock.clock });
    const pane = makeDprPane('a', log, policy, clock.clock);
    const owner = {};
    policy.suspend(owner, () => [pane.renderer]);
    pane.moveDisplay(1);
    log.length = 0;

    policy.resume(owner, () => [pane.renderer]);
    expect(log.slice(0, 2)).toEqual(['ratio:a', 'resize:a']);
    expect(log).toContain('wipe:a');

    log.length = 0;
    pane.moveDisplay(2);
    policy.wake();
    expect(log.slice(0, 3)).toEqual(['ratio:a', 'resize:a', 'present:a']);
  });
});

function makeVisibility() {
  let hidden = false;
  let notices: PageNotices | null = null;
  let watching = 0;
  const visibility: VisibilityReading = {
    hidden: () => hidden,
    watch: (given) => {
      notices = given;
      watching += 1;
      return () => {
        watching -= 1;
        notices = null;
      };
    },
  };
  return {
    visibility,
    watching: () => watching,
    setHidden(next: boolean): void {
      hidden = next;
      notices?.changed();
    },
    focus: (): void => notices?.focused(),
    blur: (): void => notices?.blurred(),
  };
}

function makePagePane() {
  const events: string[] = [];
  const pane: PagePane = {
    pageHide: () => events.push('hide'),
    pageReveal: () => events.push('reveal'),
  };
  return { pane, events };
}

describe('the page visibility census', () => {
  test('a hide reaches every pane once, and a reveal paints once for the page', () => {
    const page = makeVisibility();
    const policy = makePolicy({ visibility: page.visibility });
    const first = makePagePane();
    const second = makePagePane();
    policy.joinPage(first.pane);
    policy.joinPage(second.pane);
    const paint = vi.spyOn(policy, 'scheduleReveal');
    const wake = vi.spyOn(policy, 'wake');

    page.setHidden(true);
    expect(first.events).toEqual(['hide']);
    expect(second.events).toEqual(['hide']);
    page.setHidden(true);
    expect(first.events).toEqual(['hide']);

    page.setHidden(false);
    expect(first.events).toEqual(['hide', 'reveal']);
    expect(second.events).toEqual(['hide', 'reveal']);
    expect(paint).toHaveBeenCalledTimes(1);
    expect(wake).not.toHaveBeenCalled();
  });

  test('focus while the page still reports itself hidden reveals without the wake', () => {
    const page = makeVisibility();
    const policy = makePolicy({ visibility: page.visibility });
    const member = makePagePane();
    policy.joinPage(member.pane);
    const wake = vi.spyOn(policy, 'wake');

    page.setHidden(true);
    expect(member.events).toEqual(['hide']);
    page.focus();
    expect(member.events).toEqual(['hide', 'reveal']);
    expect(wake).not.toHaveBeenCalled();
  });

  test('a blur that landed while the page was hidden wakes it fully on return', () => {
    const page = makeVisibility();
    const policy = makePolicy({ visibility: page.visibility });
    const member = makePagePane();
    policy.joinPage(member.pane);
    const wake = vi.spyOn(policy, 'wake');

    page.setHidden(true);
    page.blur();
    page.setHidden(false);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  test('the last pane out takes the page listeners with it', () => {
    const page = makeVisibility();
    const policy = makePolicy({ visibility: page.visibility });
    const first = makePagePane();
    const second = makePagePane();
    policy.joinPage(first.pane);
    policy.joinPage(second.pane);
    expect(page.watching()).toBe(1);

    policy.leavePage(first.pane);
    expect(page.watching()).toBe(1);
    policy.leavePage(second.pane);
    expect(page.watching()).toBe(0);

    page.setHidden(true);
    expect(first.events).toEqual([]);
    expect(second.events).toEqual([]);
  });

  test('a pane joining an already hidden page starts hidden and returns with the page', () => {
    const page = makeVisibility();
    const policy = makePolicy({ visibility: page.visibility });
    const first = makePagePane();
    policy.joinPage(first.pane);
    page.setHidden(true);
    expect(first.events).toEqual(['hide']);

    policy.releasePage();
    expect(page.watching()).toBe(0);

    const next = makePagePane();
    policy.joinPage(next.pane);
    expect(next.events).toEqual(['hide']);
    page.setHidden(false);
    expect(next.events).toEqual(['hide', 'reveal']);
  });
});
