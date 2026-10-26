import { Host, type HostOs } from '@runlith/layer/Host';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { TerminalAppearance } from '../appearance/Settings.svelte.js';
import type { DprRepair, TerminalRenderer } from './Renderer.js';

export type RenderMode = 'auto' | 'on' | 'off';

export interface RendererReading {
  readonly webgl2: boolean;
  readonly renderer: string | null;
  readonly vendor: string | null;
  readonly displayServer: 'wayland' | 'x11' | null;
}

export type RendererProbe = () => RendererReading;

export interface WebglVerdict {
  readonly allowed: boolean;
  readonly reason:
    | 'non-linux'
    | 'linux-hardware-renderer'
    | 'linux-wayland'
    | 'linux-webgl2-unavailable'
    | 'linux-renderer-unavailable'
    | 'linux-software-renderer';
  readonly renderer: string | null;
  readonly vendor: string | null;
}

export interface RenderClock {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  delay(callback: () => void, ms: number): number;
  now(): number;
}

export interface DisplayReading {
  ratio(): number;
  watch(moved: () => void): () => void;
}

export interface PageNotices {
  changed(): void;
  focused(): void;
  blurred(): void;
}

export interface VisibilityReading {
  hidden(): boolean;
  watch(notices: PageNotices): () => void;
}

export interface PagePane {
  pageHide(): void;
  pageReveal(): void;
}

export interface HiddenPane {
  heldBytes(): number;
  park(): void;
}

const SOFTWARE_RENDERER = /\b(swiftshader|llvmpipe|softpipe|software rasterizer|software adapter|basic render|virgl|svga3d)\b/i;

const MAX_RETAINED_HIDDEN_CONTEXTS = 6;

const HIDDEN_ENGINE_BYTES = { desktop: 64 * 1024 * 1024, tab: 16 * 1024 * 1024, mobile: 8 * 1024 * 1024 } as const;

const WAKE_PRESENT_DELAYS_MS = [120, 500] as const;

const DPR_RETRY_FRAMES = 16;

interface HiddenOwner {
  readonly owner: object;
  readonly renderers: () => Iterable<TerminalRenderer>;
}

export class TerminalRenderPolicy extends Service<TerminalRenderPolicy>()('TerminalRenderPolicy', { tier: 'app' }) {
  static *make() {
    const appearance = yield* TerminalAppearance;
    const scope = yield* Scope;
    const policy = new TerminalRenderPolicy(yield* Host, readRenderer, pageClock, () => appearance.webgl());
    scope.defer(policy.watchDisplay(pageDisplay));
    scope.defer(() => {
      policy.releasePage();
      policy.releasePlaces();
    });
    return policy;
  }

  private decision: WebglVerdict | null = null;
  private suggestion: 'dom' | null = null;
  private lastMode: RenderMode | null = null;
  private readonly live = new Set<TerminalRenderer>();
  private readonly hidden: HiddenOwner[] = [];
  private readonly warm = new Map<HiddenPane, number>();
  private warmBytes = 0;
  private readonly places = new Map<Element, (visible: boolean) => void>();
  private observer: IntersectionObserver | null = null;
  private revealScheduled = false;
  private readonly panes = new Set<PagePane>();
  private pageHidden = false;
  private blurredWhileHidden = false;
  private watchingPage: (() => void) | null = null;

  constructor(
    private readonly host: Host,
    private readonly probe: RendererProbe,
    private readonly clock: RenderClock,
    private readonly mode: () => RenderMode,
    private readonly visibility: VisibilityReading = pageVisibility,
  ) {
    super();
  }

  verdict(): WebglVerdict {
    this.decision ??= decide(this.host.os, this.probe);
    return this.decision;
  }

  allowsWebgl(): boolean {
    const mode = this.mode();
    if (this.lastMode !== null && mode !== this.lastMode) this.reconsider();
    this.lastMode = mode;
    if (mode === 'on') return true;
    if (mode !== 'auto' || this.suggestion === 'dom') return false;
    return this.verdict().allowed;
  }

  suggestDom(): void {
    if (this.mode() === 'auto') this.suggestion = 'dom';
  }

  reconsider(): void {
    this.suggestion = null;
    this.decision = null;
  }

  join(renderer: TerminalRenderer): () => void {
    this.live.add(renderer);
    return () => {
      this.live.delete(renderer);
    };
  }

  recover(): void {
    const panes = this.recoverable();
    for (const renderer of panes) attempt(() => renderer.wipeAtlas());
    for (const renderer of panes) attempt(() => renderer.present());
  }

  scheduleReveal(): void {
    if (this.revealScheduled) return;
    this.revealScheduled = true;
    this.clock.requestFrame(() => {
      this.clock.requestFrame(() => {
        this.revealScheduled = false;
        const panes = this.recoverable();
        for (const renderer of panes) attempt(() => renderer.reattach());
        if (panes.length > 0) this.recover();
      });
    });
  }

  wake(): void {
    for (const renderer of this.recoverable()) {
      if (repairOf(renderer) === 'repaired') attempt(() => renderer.present());
    }
    this.scheduleReveal();
    for (const ms of WAKE_PRESENT_DELAYS_MS) {
      this.clock.delay(() => {
        for (const renderer of this.recoverable()) attempt(() => renderer.present());
      }, ms);
    }
  }

  suspend(owner: object, renderers: () => Iterable<TerminalRenderer>): void {
    for (const renderer of renderers()) attempt(() => renderer.suspend());
    if (this.retain(owner, renderers)) return;
    for (const renderer of renderers()) attempt(() => renderer.dispose());
  }

  resume(owner: object, renderers: () => Iterable<TerminalRenderer>): void {
    this.forget(owner);
    for (const renderer of renderers()) attempt(() => renderer.resume());
    let repaired = false;
    for (const renderer of renderers()) {
      if (repairOf(renderer) === 'repaired') repaired = true;
    }
    if (repaired) this.recover();
  }

  watchDisplay(display: DisplayReading): () => void {
    let observed = display.ratio();
    let frames = 0;
    let chasing = false;
    const repairPanes = (ratio: number): boolean => {
      let deferred = false;
      for (const renderer of this.recoverable()) {
        const state = repairOf(renderer);
        if (state === 'deferred') deferred = true;
        if (state === 'repaired') attempt(() => renderer.present());
      }
      if (!deferred) observed = ratio;
      return !deferred;
    };
    const chase = (): void => {
      chasing = false;
      if (repairPanes(display.ratio())) return;
      frames -= 1;
      if (frames <= 0) return;
      chasing = true;
      this.clock.requestFrame(chase);
    };
    return display.watch(() => {
      const ratio = display.ratio();
      if (ratio === observed || chasing) return;
      if (repairPanes(ratio)) return;
      frames = DPR_RETRY_FRAMES;
      chasing = true;
      this.clock.requestFrame(chase);
    });
  }

  watchPlace(element: Element, changed: (visible: boolean) => void): () => void {
    this.observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) this.places.get(entry.target)?.(entry.isIntersecting);
    });
    this.places.set(element, changed);
    this.observer.observe(element);
    return () => {
      if (this.places.get(element) !== changed) return;
      this.places.delete(element);
      this.observer?.unobserve(element);
      if (this.places.size === 0) this.releasePlaces();
    };
  }

  private releasePlaces(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.places.clear();
  }

  joinPage(pane: PagePane): void {
    this.panes.add(pane);
    if (this.pageHidden) pane.pageHide();
    else if (this.visibility.hidden()) this.hidePage();
    if (this.watchingPage !== null) return;
    this.watchingPage = this.visibility.watch({
      changed: () => {
        if (this.visibility.hidden()) this.hidePage();
        else this.revealPage(this.blurredWhileHidden);
      },
      focused: () => {
        if (this.pageHidden) this.revealPage(false);
      },
      blurred: () => {
        if (this.pageHidden) this.blurredWhileHidden = true;
      },
    });
  }

  leavePage(pane: PagePane): void {
    this.panes.delete(pane);
    if (this.panes.size === 0) this.releasePage();
  }

  releasePage(): void {
    this.panes.clear();
    this.watchingPage?.();
    this.watchingPage = null;
    this.pageHidden = false;
    this.blurredWhileHidden = false;
  }

  private hidePage(): void {
    if (this.pageHidden) return;
    this.pageHidden = true;
    this.blurredWhileHidden = false;
    for (const pane of [...this.panes]) attempt(() => pane.pageHide());
  }

  private revealPage(wake: boolean): void {
    if (!this.pageHidden) return;
    this.pageHidden = false;
    this.blurredWhileHidden = false;
    for (const pane of [...this.panes]) attempt(() => pane.pageReveal());
    if (wake) this.wake();
    else this.scheduleReveal();
  }

  forget(owner: object): void {
    const at = this.hidden.findIndex((entry) => entry.owner === owner);
    if (at !== -1) this.hidden.splice(at, 1);
  }

  hide(pane: HiddenPane): void {
    if (this.warm.has(pane)) {
      this.changed(pane);
      return;
    }
    const bytes = pane.heldBytes();
    this.warm.set(pane, bytes);
    this.warmBytes += bytes;
    this.trim();
  }

  changed(pane: HiddenPane): void {
    const held = this.warm.get(pane);
    if (held === undefined) return;
    const bytes = pane.heldBytes();
    this.warm.set(pane, bytes);
    this.warmBytes += bytes - held;
    this.trim();
  }

  unhide(pane: HiddenPane): void {
    const held = this.warm.get(pane);
    if (held === undefined) return;
    this.warm.delete(pane);
    this.warmBytes -= held;
  }

  private trim(): void {
    while (this.warmBytes > HIDDEN_ENGINE_BYTES[this.host.kind]) {
      const oldest = this.warm.keys().next().value;
      if (oldest === undefined) return;
      this.unhide(oldest);
      oldest.park();
    }
  }

  get retained(): number {
    return this.hidden.length;
  }

  private retain(owner: object, renderers: () => Iterable<TerminalRenderer>): boolean {
    this.forget(owner);
    const own = attachedCount(renderers);
    if (own === 0 || own > MAX_RETAINED_HIDDEN_CONTEXTS) return false;
    let total = own;
    for (const entry of this.hidden) total += attachedCount(entry.renderers);
    while (total > MAX_RETAINED_HIDDEN_CONTEXTS && this.hidden.length > 0) {
      const evicted = this.hidden.shift() as HiddenOwner;
      total -= attachedCount(evicted.renderers);
      for (const renderer of evicted.renderers()) attempt(() => renderer.dispose());
    }
    this.hidden.push({ owner, renderers });
    return true;
  }

  private recoverable(): TerminalRenderer[] {
    return [...this.live].filter((renderer) => !renderer.suspended && !renderer.destroyed);
  }
}

function decide(os: HostOs, probe: RendererProbe): WebglVerdict {
  if (os !== 'linux') return { allowed: true, reason: 'non-linux', renderer: null, vendor: null };
  const reading = probe();
  const identity = { renderer: reading.renderer, vendor: reading.vendor };
  if (reading.displayServer === 'wayland') return { allowed: false, reason: 'linux-wayland', ...identity };
  if (!reading.webgl2) return { allowed: false, reason: 'linux-webgl2-unavailable', ...identity };
  if (reading.renderer === null && reading.vendor === null) {
    return { allowed: false, reason: 'linux-renderer-unavailable', ...identity };
  }
  if (SOFTWARE_RENDERER.test(`${reading.vendor ?? ''} ${reading.renderer ?? ''}`)) {
    return { allowed: false, reason: 'linux-software-renderer', ...identity };
  }
  return { allowed: true, reason: 'linux-hardware-renderer', ...identity };
}

function attachedCount(renderers: () => Iterable<TerminalRenderer>): number {
  let count = 0;
  for (const renderer of renderers()) {
    if (renderer.attached) count += 1;
  }
  return count;
}

function repairOf(renderer: TerminalRenderer): DprRepair {
  try {
    return renderer.repairDpr();
  } catch {
    return 'deferred';
  }
}

function attempt(step: () => void): void {
  try {
    step();
  } catch {}
}

const pageClock: RenderClock = {
  requestFrame: (callback) =>
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : (setTimeout(callback, 0) as unknown as number),
  cancelFrame: (handle) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    else clearTimeout(handle);
  },
  delay: (callback, ms) => setTimeout(callback, ms) as unknown as number,
  now: () => Date.now(),
};

const pageDisplay: DisplayReading = {
  ratio: () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio),
  watch: (moved) => {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener('resize', moved);
    return () => window.removeEventListener('resize', moved);
  },
};

const pageVisibility: VisibilityReading = {
  hidden: () => typeof document !== 'undefined' && document.hidden,
  watch: (notices) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;
    document.addEventListener('visibilitychange', notices.changed);
    window.addEventListener('focus', notices.focused);
    window.addEventListener('blur', notices.blurred);
    return () => {
      document.removeEventListener('visibilitychange', notices.changed);
      window.removeEventListener('focus', notices.focused);
      window.removeEventListener('blur', notices.blurred);
    };
  },
};

function readRenderer(): RendererReading {
  const unavailable: RendererReading = { webgl2: false, renderer: null, vendor: null, displayServer: null };
  if (typeof document === 'undefined') return unavailable;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return unavailable;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debug) return { webgl2: true, renderer: null, vendor: null, displayServer: null };
    const renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? '');
    const vendor = String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) ?? '');
    return { webgl2: true, renderer: renderer || null, vendor: vendor || null, displayServer: null };
  } catch {
    return unavailable;
  }
}
