import type { WebglAddon } from '@xterm/addon-webgl';
import type { IDisposable, Terminal } from '@xterm/xterm';
import type { RenderClock, TerminalRenderPolicy } from './RenderPolicy.js';

export type WebglAddonFactory = () => WebglAddon;

export type DprRepair = 'current' | 'deferred' | 'repaired';

const CONTEXT_LOSS_LIMIT = 3;
const CONTEXT_LOSS_WINDOW_MS = 60_000;

const DISPLAYED_PRESENT_RETRY_FRAMES = 16;

type PresentMode = 'buffer' | 'frame';

interface DisplayedPresentRetry {
  frames: number;
  mode: PresentMode;
}

interface XtermRenderer {
  renderRows?: (start: number, end: number) => void;
  _canvas?: HTMLCanvasElement;
  _devicePixelRatio?: number;
  _gl?: { canvas?: HTMLCanvasElement; isContextLost?: () => boolean };
  dimensions?: { device?: { canvas?: { width?: number; height?: number } } };
  handleDevicePixelRatioChange?: () => void;
  handleResize?: (cols: number, rows: number) => void;
}

interface XtermRenderService {
  _isPaused?: boolean;
  _needsFullRefresh?: boolean;
  refreshRows?: (start: number, end: number, sync?: boolean) => void;
  _renderer?: { value?: XtermRenderer | null } | XtermRenderer | null;
}

interface XtermCore {
  _core?: {
    _renderService?: XtermRenderService;
    coreService?: { decPrivateModes?: { synchronizedOutput?: boolean } };
    _coreService?: { decPrivateModes?: { synchronizedOutput?: boolean } };
  };
}

interface WebglAddonInternals {
  _renderer?: {
    _canvas?: HTMLCanvasElement;
    _gl?: {
      isContextLost?: () => boolean;
      getExtension(name: 'WEBGL_lose_context'): WEBGL_lose_context | null;
    };
  };
}

export class TerminalRenderer {
  private terminal: Terminal | null = null;
  private addon: WebglAddon | null = null;
  private lossRelease: IDisposable | null = null;
  private losses: number[] = [];
  private lostContext = false;
  private attachFailed = false;
  private deferred = false;
  private rebuildDeferred = false;
  private hadWebgl = false;
  private frame: number | null = null;
  private retry: DisplayedPresentRetry | null = null;
  private gone = false;

  constructor(
    private readonly policy: TerminalRenderPolicy,
    private readonly makeAddon: WebglAddonFactory,
    private readonly clock: RenderClock,
    private readonly requestRefit: () => void,
  ) {}

  open(terminal: Terminal): void {
    this.terminal = terminal;
    this.attach();
  }

  get attached(): boolean {
    return this.addon !== null;
  }

  get suspended(): boolean {
    return this.deferred;
  }

  get destroyed(): boolean {
    return this.gone;
  }

  attach(): void {
    const terminal = this.terminal;
    if (!terminal || this.gone) return;
    if (!this.eligible()) {
      this.dispose({ refit: true });
      return;
    }
    this.dispose();
    let addon: WebglAddon | null = null;
    try {
      addon = this.makeAddon();
      this.lossRelease = addon.onContextLoss(() => this.loseContext());
      terminal.loadAddon(addon);
      this.addon = addon;
      attempt(() => terminal.refresh(0, terminal.rows - 1));
    } catch {
      this.attachFailed = true;
      this.policy.suggestDom();
      attempt(() => addon?.dispose());
      this.addon = null;
      this.lossRelease = null;
    }
  }

  reattach(): void {
    if (this.addon || this.gone) return;
    if (!this.clearLossForRetry()) return;
    this.attach();
  }

  rebuild(): void {
    if (!this.addon || this.lostContext || this.gone) return;
    if (this.deferred) {
      this.rebuildDeferred = true;
      return;
    }
    this.rebuildDeferred = false;
    this.dispose();
    this.attachFailed = false;
    this.attach();
  }

  dispose(options: { readonly refit?: boolean } = {}): void {
    this.cancelFrame();
    if (!this.addon) return;
    releaseContext(this.addon);
    attempt(() => this.lossRelease?.dispose());
    attempt(() => this.addon?.dispose());
    this.lossRelease = null;
    this.addon = null;
    if (!options.refit) return;
    this.frame = this.clock.requestFrame(() => {
      this.frame = null;
      attempt(() => this.requestRefit());
      const terminal = this.terminal;
      if (terminal) attempt(() => terminal.refresh(0, terminal.rows - 1));
    });
  }

  disposeForReparent(): void {
    this.hadWebgl = this.addon !== null;
    this.dispose();
    if (!this.hadWebgl || this.gone) return;
    this.frame = this.clock.requestFrame(() => {
      this.frame = null;
      this.hadWebgl = false;
      this.reattach();
    });
  }

  suspend(): void {
    this.deferred = true;
    const terminal = this.terminal;
    if (terminal) attempt(() => terminal.blur());
  }

  resume(): void {
    if (this.gone) return;
    this.attachFailed = false;
    const rebuild = this.rebuildDeferred;
    this.deferred = false;
    this.rebuildDeferred = false;
    this.clearLossForRetry();
    if (this.addon && this.contextLost()) this.dispose();
    if (rebuild && this.addon) {
      this.rebuild();
      return;
    }
    this.reattach();
  }

  afterFit(): void {
    if (!this.addon && this.eligible()) {
      this.attach();
      if (this.addon) {
        this.frame = this.clock.requestFrame(() => {
          this.frame = null;
          attempt(() => this.requestRefit());
        });
      }
    }
    this.repairDpr();
  }

  present(): void {
    this.presentWith('buffer');
  }

  presentPreservingFrame(): void {
    this.presentWith('frame');
  }

  wipeAtlas(): void {
    if (this.lostContext) return;
    attempt(() => this.addon?.clearTextureAtlas());
  }

  repairDpr(): DprRepair {
    const terminal = this.terminal;
    const renderer = rendererOf(terminal);
    const canvas = renderer?._canvas ?? renderer?._gl?.canvas;
    if (!terminal || !renderer || !canvas) return 'current';
    if (!canvas.isConnected) return 'deferred';
    const view = canvas.ownerDocument?.defaultView ?? null;
    const expected = renderer.dimensions?.device?.canvas;
    const width = expected?.width ?? 0;
    const height = expected?.height ?? 0;
    if (!view || width <= 0 || height <= 0) return 'deferred';
    const cached = renderer._devicePixelRatio;
    const ratioMoved = typeof cached === 'number' && cached !== view.devicePixelRatio;
    const tolerance = Math.max(1, Math.ceil(view.devicePixelRatio / 2));
    if (!ratioMoved && Math.abs(canvas.width - width) <= tolerance && Math.abs(canvas.height - height) <= tolerance) {
      return 'current';
    }
    try {
      renderer.handleDevicePixelRatioChange?.();
      renderer.handleResize?.(terminal.cols, terminal.rows);
      terminal.refresh(0, terminal.rows - 1);
    } catch {
      return 'deferred';
    }
    return 'repaired';
  }

  destroy(): void {
    this.gone = true;
    this.retry = null;
    this.dispose();
    this.terminal = null;
  }

  private eligible(): boolean {
    return this.policy.allowsWebgl() && !this.deferred && !this.lostContext && !this.attachFailed;
  }

  private loseContext(): void {
    this.losses = [...this.recentLosses(), this.clock.now()];
    this.lostContext = true;
    this.dispose({ refit: true });
  }

  private recentLosses(): number[] {
    const cutoff = this.clock.now() - CONTEXT_LOSS_WINDOW_MS;
    return this.losses.filter((at) => at > cutoff);
  }

  private clearLossForRetry(): boolean {
    if (!this.lostContext) return true;
    this.losses = this.recentLosses();
    if (this.losses.length >= CONTEXT_LOSS_LIMIT) return false;
    this.lostContext = false;
    return true;
  }

  private contextLost(): boolean {
    try {
      return (this.addon as unknown as WebglAddonInternals | null)?._renderer?._gl?.isContextLost?.() === true;
    } catch {
      return true;
    }
  }

  private presentWith(mode: PresentMode): void {
    const terminal = this.terminal;
    if (!terminal || this.lostContext || this.gone) return;
    if (this.displayNone()) {
      attempt(() => terminal.refresh(0, terminal.rows - 1));
      this.retryWhenDisplayed(mode);
      return;
    }
    const presented = mode === 'buffer' ? forcePresent(terminal) : requestPresent(terminal);
    if (!presented) attempt(() => terminal.refresh(0, terminal.rows - 1));
  }

  private retryWhenDisplayed(mode: PresentMode): void {
    const pending = this.retry;
    if (pending) {
      if (mode === 'buffer') pending.mode = mode;
      return;
    }
    this.retry = { frames: DISPLAYED_PRESENT_RETRY_FRAMES, mode };
    const tick = (): void => {
      const retry = this.retry;
      if (!retry || retry.frames <= 0 || !this.terminal || this.gone) {
        this.retry = null;
        return;
      }
      if (this.displayNone()) {
        if (retry.frames === 1) {
          this.retry = null;
          return;
        }
        retry.frames -= 1;
        this.clock.requestFrame(tick);
        return;
      }
      this.retry = null;
      this.presentWith(retry.mode);
    };
    this.clock.requestFrame(tick);
  }

  private displayNone(): boolean {
    const element = this.terminal?.element ?? null;
    const view = element?.ownerDocument?.defaultView ?? null;
    if (!element || !view) return false;
    for (let current: HTMLElement | null = element; current; current = current.parentElement) {
      if (view.getComputedStyle(current).display === 'none') return true;
    }
    return false;
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.clock.cancelFrame(this.frame);
    this.frame = null;
  }
}

function releaseContext(addon: WebglAddon): void {
  try {
    const renderer = (addon as unknown as WebglAddonInternals)._renderer;
    renderer?._gl?.getExtension('WEBGL_lose_context')?.loseContext();
    if (renderer?._canvas) {
      renderer._canvas.width = 0;
      renderer._canvas.height = 0;
    }
  } catch {}
}

function forcePresent(terminal: Terminal): boolean {
  const service = renderServiceOf(terminal);
  const rows = terminal.rows;
  if (!service || typeof rows !== 'number' || rows < 1) return false;
  const paused = service._isPaused === true;
  const held = synchronizedOutputHeld(terminal);
  if (!paused && !held) return false;
  releasePause(service, paused);
  try {
    const renderer = rendererOfService(service);
    if (held && typeof renderer?.renderRows === 'function') {
      renderer.renderRows(0, rows - 1);
      return true;
    }
    service.refreshRows?.(0, rows - 1, true);
    return true;
  } catch {
    return false;
  }
}

function requestPresent(terminal: Terminal): boolean {
  const service = renderServiceOf(terminal);
  const rows = terminal.rows;
  if (!service || typeof rows !== 'number' || rows < 1) return false;
  const paused = service._isPaused === true;
  if (!paused && !synchronizedOutputHeld(terminal)) return false;
  releasePause(service, paused);
  try {
    service.refreshRows?.(0, rows - 1, true);
    return true;
  } catch {
    return false;
  }
}

function releasePause(service: XtermRenderService, paused: boolean): void {
  if (!paused) return;
  service._isPaused = false;
  service._needsFullRefresh = false;
}

function renderServiceOf(terminal: Terminal | null): XtermRenderService | null {
  const service = (terminal as unknown as XtermCore | null)?._core?._renderService;
  return service && typeof service.refreshRows === 'function' ? service : null;
}

function rendererOf(terminal: Terminal | null): XtermRenderer | null {
  const service = (terminal as unknown as XtermCore | null)?._core?._renderService;
  return service ? rendererOfService(service) : null;
}

function rendererOfService(service: XtermRenderService): XtermRenderer | null {
  const holder = service._renderer;
  if (!holder) return null;
  if (typeof (holder as XtermRenderer).renderRows === 'function') return holder as XtermRenderer;
  return (holder as { value?: XtermRenderer | null }).value ?? null;
}

function synchronizedOutputHeld(terminal: Terminal): boolean {
  const core = (terminal as unknown as XtermCore)._core;
  return (core?.coreService?.decPrivateModes ?? core?._coreService?.decPrivateModes)?.synchronizedOutput === true;
}

function attempt(step: () => void): void {
  try {
    step();
  } catch {}
}
