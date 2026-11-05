import type {
  Anchor,
  Drag,
  Frame,
  LayoutBox,
  Mount,
  Navigation,
  ObservedEntries,
  Recording,
  Rect,
  RowChange,
  RowRect,
  ScrollWrite,
  Sentinel,
  Targets,
  WheelRun,
} from './recording';
import { Signatures } from './signature';

const box = (rect: Rect): Rect => ({
  top: rect.top,
  bottom: rect.bottom,
  left: rect.left,
  right: rect.right,
  height: rect.height,
  width: rect.width,
});
const message = (label: string | null): string | null => label?.match(/^Message \d+/)?.[0] ?? null;
export type RecorderOptions = { timing?: boolean };
type MeasuredRow = { height: number; width: number; stable: number };
type SampleState = {
  last: Frame | null;
  keys: Set<string>;
  anchor: string | null;
  kind: Anchor['kind'];
  gap: number;
  moving: boolean;
  command: Navigation | null;
  landing: number | null;
  hits: number;
  measured: Map<string, MeasuredRow | undefined>;
};

export function scroller(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-scrollable][role="group"]');
  if (element === null) throw new Error('ChatSurface has no scroller');
  return element;
}

export class Recorder {
  private frame = 0;
  private lastTime = 0;
  private clockOnly = false;
  private pendingTime: number | null = null;
  private probe: HTMLElement | null = null;
  private layoutObserver: ResizeObserver | null = null;
  private candidate: Frame | null = null;
  private sampleState: SampleState | null = null;
  private readonly observed = new Set<Element>();
  private recording: Recording | null = null;
  private signatures: Signatures | null = null;
  private readonly identities = new WeakMap<Node, number>();
  private identity = 0;
  private endGap = 0;
  private ownMovement = false;
  private tick = 0;
  private wroteAt: number | null = null;
  private unended = false;
  private readonly writeFrames = new Set<number>();
  private unhookWrites = () => {};
  private touching = false;
  private finger: number | null = null;
  private lastSample: Frame | null = null;
  private declaredTouchStart = false;
  private declaredTouchEnd = false;
  private activeDrag: Drag | null = null;
  private activeWheel: WheelRun | null = null;
  private activeEnded = true;
  private command: Navigation | null = null;
  private landingHits = 0;
  private controlRow: string | null = null;
  private controlNode: Element | null = null;
  private controlIndex = 0;
  private anchorRow: string | null = null;
  private anchorKind: Anchor['kind'] = 'paused';
  private readonly presses: (() => void)[] = [];
  private readonly releases: (() => void)[] = [];
  private selected: string | null = null;
  private mutation = 0;
  private readonly measured = new Map<string, MeasuredRow>();
  private previousKeys = new Set<string>();
  private readonly cleanups: (() => void)[] = [];
  private readonly waiters: { remaining: number; resolve(): void }[] = [];
  private lastWheel: number | null = null;
  private readonly settles: (() => void)[] = [];

  constructor(
    private readonly entries: ObservedEntries,
    options: RecorderOptions = {},
  ) {
    this.clockOnly = options.timing ?? false;
    const root = scroller();
    if (!this.clockOnly) this.signatures = new Signatures(root);
    const listen = (target: EventTarget, name: string, handler: EventListener, capture = false) => {
      target.addEventListener(name, handler, { capture, passive: true });
      this.cleanups.push(() => target.removeEventListener(name, handler, capture));
    };
    const reader = () => {
      if (this.clockOnly) return;
      this.settle();
      this.ownMovement = true;
      this.unended = !('onscrollend' in root);
      this.selected = null;
      this.controlRow = null;
      this.controlNode = null;
      this.endGap = Math.max(0, root.scrollHeight - root.clientHeight - root.scrollTop);
    };
    for (const name of ['wheel', 'keydown']) listen(root, name, reader, true);
    listen(
      root,
      'wheel',
      (event) => {
        if (event.isTrusted) this.lastWheel = event.timeStamp;
      },
      true,
    );
    listen(root, 'scrollend', (event) => {
      if (!event.isTrusted) return;
      this.recording?.scrollEnds?.push(event.timeStamp);
      if (this.lastWheel === null || event.timeStamp < this.lastWheel) return;
      this.lastWheel = null;
      for (const resolve of this.settles.splice(0)) resolve();
    });
    listen(
      root,
      'wheel',
      (event) => {
        if (!event.isTrusted || this.recording === null || this.activeWheel === null) return;
        const wheel = event as WheelEvent;
        this.activeWheel.steps.push({
          frame: this.count() + Number(this.candidate !== null),
          deltaY: wheel.deltaY,
          deltaMode: wheel.deltaMode,
          stamp: wheel.timeStamp,
          received: performance.now(),
        });
      },
      true,
    );
    listen(
      root,
      'scroll',
      (event) => {
        if (!event.isTrusted) return;
        this.recording?.scrolls?.push({ stamp: event.timeStamp, received: performance.now(), top: root.scrollTop });
      },
      true,
    );
    let releaseContact = () => {};
    this.cleanups.push(() => releaseContact());
    const contactEvents = ['touchmove', 'touchend', 'touchcancel'] as const;
    const touch = (event: Event) => {
      if (!event.isTrusted) return;
      const sample = event as TouchEvent;
      const point = sample.touches[0] ?? sample.changedTouches[0];
      this.recording?.touches.push({
        type: event.type,
        timeStamp: event.timeStamp,
        received: performance.now(),
        x: point?.clientX ?? null,
        y: point?.clientY ?? null,
      });
      if (event.type === 'touchstart') {
        this.declaredTouchEnd = false;
        if (this.recording !== null) {
          this.declaredTouchStart = true;
          for (const resolve of this.presses.splice(0)) resolve();
        }
      }
      if (event.type === 'touchend' && this.recording !== null) {
        if (this.activeDrag !== null) this.activeDrag.toFrame = this.count();
        this.declaredTouchEnd = true;
        for (const resolve of this.releases.splice(0)) resolve();
      }
      this.finger = point?.clientY ?? this.finger;
      this.touching = event.type === 'touchstart' || event.type === 'touchmove';
      if (event.type === 'touchmove') reader();
      if (event.type === 'touchend' || event.type === 'touchcancel') releaseContact();
    };
    listen(
      root,
      'touchstart',
      (event) => {
        if (!event.isTrusted) return;
        releaseContact();
        const target = event.target;
        if (target !== null) {
          for (const type of contactEvents) target.addEventListener(type, touch, { capture: true, passive: true });
          releaseContact = () => {
            for (const type of contactEvents) target.removeEventListener(type, touch, true);
            releaseContact = () => {};
          };
        }
        touch(event);
      },
      true,
    );
    listen(root, 'scroll', () => {
      if (!this.clockOnly && this.ownMovement) this.endGap = Math.max(0, root.scrollHeight - root.clientHeight - root.scrollTop);
    });
    listen(root, 'scrollend', () => {
      if (this.wroteAt !== null && this.tick - this.wroteAt <= 1) {
        this.wroteAt = null;
        if (this.ownMovement) this.unended = true;
        return;
      }
      this.ownMovement = false;
      this.unended = false;
    });
    if (!this.clockOnly) this.unhookWrites = this.hookWrites(root);
    listen(
      document,
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest<HTMLButtonElement>('[role="navigation"] button');
        if (button !== null && button !== undefined) {
          this.selected = message(button.getAttribute('aria-label'));
          if (this.selected !== null) this.navigate(event, 'rail', this.selected);
          this.ownMovement = true;
        } else if (target !== null && target.closest(`[aria-label="${CSS.escape(this.entries.jump)}"]`) !== null) {
          this.selected = null;
          this.navigate(event, 'latest', 'latest');
          this.ownMovement = true;
        } else {
          const control = target?.closest('[aria-expanded]');
          const row = control?.closest<HTMLElement>('[data-timeline-key]');
          if (control !== null && control !== undefined && row !== null && row !== undefined && root.contains(row)) {
            this.controlRow = row.dataset.timelineKey!;
            this.controlNode = control;
            this.controlIndex = [...row.querySelectorAll('[aria-expanded]')].indexOf(control);
          }
        }
      },
      true,
    );
    listen(
      document,
      'keydown',
      (event) => {
        const key = event as KeyboardEvent;
        if (!(key.metaKey || key.ctrlKey) || !key.altKey || key.shiftKey || !['[', ']'].includes(key.key)) return;
        const editable =
          key.target instanceof Element && key.target.closest('input, textarea, select, button, [contenteditable="true"]') !== null;
        if (editable) return;
        const tiles = [...root.parentElement!.querySelectorAll('[role="navigation"] button')];
        const current = tiles.findIndex((tile) => tile.getAttribute('aria-current') === 'location');
        const index = (current < 0 ? tiles.length : current) + (key.key === '[' ? -1 : 1);
        if (index < 0 || index > tiles.length) return;
        const target = tiles[index];
        const label = target === undefined ? 'latest' : message(target.getAttribute('aria-label'));
        if (label !== null) {
          this.navigate(event, 'keyboard', label);
          this.selected = label === 'latest' ? null : label;
          this.ownMovement = true;
        }
      },
      true,
    );
    let pulse = false;
    const sample = (time: number) => {
      this.tick += 1;
      if (this.finishFrame()) this.advance();
      if (this.clockOnly) {
        this.lastTime = time;
        this.recording?.timings?.push(time);
        this.advance();
      } else if (this.recording !== null || this.waiters.length > 0) {
        this.recording?.ticks?.push(time);
        if (this.probe === null && root.querySelector('[data-timeline-key]') === null) {
          if (this.recording !== null) this.recording.frames.push(this.read(time));
          this.advance();
        } else {
          this.prepareLayout();
          this.watchRows();
          this.sampleState = {
            last: this.lastSample,
            keys: this.previousKeys,
            anchor: this.anchorRow,
            kind: this.anchorKind,
            gap: this.endGap,
            moving: this.ownMovement,
            command: this.command,
            landing: this.command?.toFrame ?? null,
            hits: this.landingHits,
            measured: new Map(),
          };
          this.pendingTime = time;
          pulse = !pulse;
          this.probe!.style.height = pulse ? '2px' : '1px';
        }
      }
      this.frame = requestAnimationFrame(sample);
    };
    this.frame = requestAnimationFrame(sample);
  }

  start(name: string): void {
    this.clearLayout();
    this.declaredTouchStart = false;
    this.declaredTouchEnd = false;
    this.lastSample = null;
    this.anchorRow = null;
    this.anchorKind = 'paused';
    this.command = null;
    this.landingHits = 0;
    this.activeDrag = null;
    this.activeWheel = null;
    this.activeEnded = true;
    if (this.recording === null) this.settle();
    this.writeFrames.clear();
    this.recording = {
      name,
      frames: [],
      touches: [],
      drags: [],
      wheels: [],
      writes: this.clockOnly ? undefined : [],
      scrolls: this.clockOnly ? undefined : [],
      scrollEnds: this.clockOnly ? undefined : [],
      commands: [],
      timings: this.clockOnly ? [] : undefined,
      ticks: this.clockOnly ? undefined : [],
    };
  }
  stop(): Recording {
    if (this.recording === null) throw new Error('No recording was started');
    this.finishFrame(true);
    this.settle();
    const result = this.recording;
    this.recording = null;
    this.activeDrag = null;
    this.activeWheel = null;
    this.activeEnded = true;
    return result;
  }
  frames(count = 1): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ remaining: count, resolve }));
  }
  frameTime(): number {
    return this.lastTime;
  }
  stable(): boolean {
    return this.previousKeys.size > 0 && [...this.previousKeys].every((key) => (this.measured.get(key)?.stable ?? 0) >= 2);
  }
  beginDrag(distance: number, speed: number, preventFling: boolean, quantum?: number): void {
    if (this.recording === null) throw new Error('Start a recording before its gesture');
    if (!this.activeEnded) throw new Error('End the previous gesture portion first');
    this.declaredTouchEnd = false;
    this.activeDrag = { distance, speed, preventFling, fromFrame: Math.max(0, this.count() - 1), toFrame: this.count(), quantum };
    this.recording.drags.push(this.activeDrag);
    this.activeEnded = false;
  }
  endDrag(): void {
    if (this.recording === null || this.activeDrag === null) throw new Error('No declared gesture is active');
    if (this.activeDrag.preventFling || !this.declaredTouchEnd) this.activeDrag.toFrame = Math.max(0, this.count() - 1);
    this.activeEnded = true;
  }
  beginWheel(): void {
    if (this.recording === null) throw new Error('Start a recording before its wheel input');
    if (this.activeWheel !== null) throw new Error('End the previous wheel input first');
    const count = this.count() + Number(this.candidate !== null);
    if (count === 0) throw new Error('Sample a baseline frame before wheel input');
    this.activeWheel = { fromFrame: count - 1, toFrame: count - 1, steps: [] };
    this.recording.wheels.push(this.activeWheel);
  }
  endWheel(): void {
    if (this.activeWheel === null) throw new Error('No discrete wheel input is active');
    const end = this.count() + Number(this.candidate !== null) - 1;
    if (end <= this.activeWheel.fromFrame) throw new Error('Sample wheel input before ending it');
    this.activeWheel.toFrame = end;
    this.activeWheel = null;
    this.ownMovement = false;
    if (this.sampleState !== null) this.sampleState.moving = false;
  }
  pressed(): Promise<void> {
    return this.declaredTouchStart ? Promise.resolve() : new Promise((resolve) => this.presses.push(resolve));
  }
  released(): Promise<void> {
    return this.declaredTouchEnd ? Promise.resolve() : new Promise((resolve) => this.releases.push(resolve));
  }
  wheelSettled(): Promise<void> {
    return this.lastWheel === null ? Promise.resolve() : new Promise((resolve) => this.settles.push(resolve));
  }
  async landed(): Promise<void> {
    const command = this.recording?.commands?.at(-1);
    if (command === undefined) throw new Error('No trusted navigation was recorded');
    if (this.clockOnly) {
      let hits = 0;
      let previous: number | undefined;
      while (hits < 2) {
        await this.frames();
        const root = scroller();
        hits = this.atLanding(root, this.viewport(root), command.target, previous) ? hits + 1 : 0;
        previous = root.scrollTop;
      }
      command.toFrame = this.count() - 1;
      return;
    }
    while (command.toFrame === null || command.toFrame >= this.count()) await this.frames();
  }
  changed(): void {
    this.mutation += 1;
  }
  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.clearLayout();
    this.signatures?.dispose();
    this.unhookWrites();
    for (const cleanup of this.cleanups) cleanup();
  }

  timing(): void {
    if (this.recording !== null) throw new Error('Choose timing mode before starting a recording');
    this.clockOnly = true;
    this.unhookWrites();
    this.clearLayout();
    this.signatures?.dispose();
    this.signatures = null;
  }

  private clearLayout(): void {
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    this.probe?.remove();
    this.probe = null;
    this.pendingTime = null;
    this.candidate = null;
    this.sampleState = null;
    this.observed.clear();
  }

  private prepareLayout(): void {
    if (this.probe !== null) return;
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;contain:strict;visibility:hidden;pointer-events:none';
    document.body.append(probe);
    this.probe = probe;
    this.layoutObserver = new ResizeObserver(() => {
      if (this.pendingTime === null || this.clockOnly) return;
      this.restoreSample();
      this.watchRows();
      if (this.recording !== null) this.candidate = this.read(this.pendingTime);
    });
    this.layoutObserver.observe(probe);
  }

  private watchRows(): void {
    const observer = this.layoutObserver;
    if (observer === null) return;
    const root = scroller();
    for (const node of this.observed) {
      if (root.contains(node)) continue;
      observer.unobserve(node);
      this.observed.delete(node);
    }
    for (const row of root.querySelectorAll('[data-timeline-key]'))
      for (const node of [row, row.parentElement!]) {
        if (this.observed.has(node)) continue;
        observer.observe(node);
        this.observed.add(node);
      }
  }

  private restoreSample(): void {
    const before = this.sampleState;
    if (before === null) return;
    this.lastSample = before.last;
    this.previousKeys = before.keys;
    this.anchorRow = before.anchor;
    this.anchorKind = before.kind;
    this.endGap = before.gap;
    this.ownMovement = before.moving;
    this.command = before.command;
    this.landingHits = before.hits;
    if (this.command !== null) this.command.toFrame = before.landing;
    for (const [key, value] of before.measured) {
      if (value === undefined) this.measured.delete(key);
      else this.measured.set(key, value);
    }
  }

  private finishFrame(discardIncomplete = false): boolean {
    const time = this.pendingTime;
    if (time === null) return false;
    if (this.recording !== null && this.candidate !== null) this.recording.frames.push(this.candidate);
    else if (discardIncomplete && this.recording?.ticks?.at(-1) === time) this.recording.ticks.pop();
    this.lastTime = time;
    this.pendingTime = null;
    this.candidate = null;
    this.sampleState = null;
    return true;
  }

  private advance(): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index]!;
      waiter.remaining -= 1;
      if (waiter.remaining <= 0) {
        this.waiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }

  private settle(): void {
    if (!this.unended) return;
    this.unended = false;
    if (!this.ownMovement) return;
    this.ownMovement = false;
    if (this.recording === null) return;
    const frames = this.recording.frames;
    let last = 0;
    for (let index = 1; index < frames.length; index += 1)
      if (frames[index]!.scrollTop !== frames[index - 1]!.scrollTop && !this.writeFrames.has(index)) last = index;
    for (let index = last + 1; index < frames.length; index += 1) if (!frames[index]!.touching) frames[index]!.moving = false;
  }

  private hookWrites(root: HTMLElement): () => void {
    const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    const read = (): number => top.get!.call(root);
    const wrote = <T>(method: ScrollWrite['method'], write: () => T): T => {
      this.wroteAt = this.tick;
      const from = read();
      const time = performance.now();
      const frame = this.count();
      const result = write();
      if (this.recording !== null) {
        this.writeFrames.add(frame);
        this.recording.writes?.push({ time, frame, method, from, to: read() });
      }
      return result;
    };
    Object.defineProperty(root, 'scrollTop', {
      configurable: true,
      get: read,
      set: (value: number) => wrote('scrollTop', () => top.set!.call(root, value)),
    });
    for (const name of ['scrollTo', 'scrollBy'] as const) {
      const write = root[name];
      Object.defineProperty(root, name, {
        configurable: true,
        writable: true,
        value: (...args: unknown[]) => wrote(name, () => Reflect.apply(write, root, args)),
      });
    }
    return () => {
      for (const name of ['scrollTop', 'scrollTo', 'scrollBy']) Reflect.deleteProperty(root, name);
      this.unhookWrites = () => {};
    };
  }

  private count(): number {
    return this.recording?.timings?.length ?? this.recording?.frames.length ?? 0;
  }

  private navigate(event: Event, kind: Navigation['kind'], target: string): void {
    if (this.recording === null) return;
    this.settle();
    this.controlRow = null;
    this.controlNode = null;
    const command: Navigation = {
      kind,
      target,
      fromFrame: this.count() + Number(this.candidate !== null),
      toFrame: null,
      timeStamp: event.timeStamp,
      received: performance.now(),
    };
    this.recording.commands!.push(command);
    this.command = command;
    this.landingHits = 0;
  }

  private layout(root: Element | null | undefined): LayoutBox[] {
    if (root === null || root === undefined) return [];
    return [root, ...root.querySelectorAll('*')].map((node) => {
      let id = this.identities.get(node);
      if (id === undefined) {
        id = ++this.identity;
        this.identities.set(node, id);
      }
      const style = getComputedStyle(node);
      return {
        id,
        parent: this.identities.get(node.parentElement!) ?? null,
        tag: node.tagName,
        classes: node.getAttribute('class') ?? '',
        rect: box(node.getBoundingClientRect()),
        height: style.height,
        margin: style.margin,
        padding: style.padding,
        overflow: style.overflow,
        animations: node.getAnimations().map((animation) => ({
          state: animation.playState,
          time: animation.currentTime === null ? null : String(animation.currentTime),
          end: String(animation.effect?.getComputedTiming().endTime),
        })),
      };
    });
  }

  targets(): Targets {
    const root = scroller();
    const surface = root.closest('.isolate');
    const visible = (element: Element | null | undefined): Rect | null => {
      if (element === null || element === undefined) return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0 ? box(rect) : null;
    };
    return {
      viewport: this.viewport(root),
      host: box((surface?.parentElement ?? root).getBoundingClientRect()),
      visual: this.visual(),
      scale: window.visualViewport?.scale ?? 1,
      composer: visible(this.composer(root)?.querySelector('textarea')),
      latest: visible(surface?.querySelector(`[aria-label="${CSS.escape(this.entries.jump)}"]`)),
      disclosure: visible(surface?.querySelector('[data-stand-disclosure="target"]')),
      rail: [...(surface?.querySelectorAll('[role="navigation"] button') ?? [])].flatMap((button) => {
        const target = message(button.getAttribute('aria-label'));
        const rect = visible(button);
        return target === null || rect === null ? [] : [{ target, rect }];
      }),
    };
  }

  private composer(root: HTMLElement): Element | null {
    const surface = root.closest('.isolate');
    let overlay = surface?.querySelector('form')?.parentElement;
    while (overlay !== null && overlay !== undefined && overlay !== surface) {
      const position = getComputedStyle(overlay).position;
      if (position === 'absolute' || position === 'fixed') return overlay;
      overlay = overlay.parentElement;
    }
    return null;
  }

  private visual(): Rect | null {
    const viewport = window.visualViewport;
    return viewport === null
      ? null
      : {
          top: viewport.offsetTop,
          bottom: viewport.offsetTop + viewport.height,
          left: viewport.offsetLeft,
          right: viewport.offsetLeft + viewport.width,
          height: viewport.height,
          width: viewport.width,
        };
  }

  private viewport(root: HTMLElement): Rect {
    const viewport = box(root.getBoundingClientRect());
    const composer = this.composer(root)?.getBoundingClientRect();
    const visual = this.visual();
    viewport.bottom = Math.min(viewport.top + root.clientHeight, composer?.top ?? viewport.bottom, visual?.bottom ?? viewport.bottom);
    viewport.top = Math.max(viewport.top, visual?.top ?? viewport.top);
    viewport.left = Math.max(viewport.left, visual?.left ?? viewport.left);
    viewport.right = Math.min(viewport.right, visual?.right ?? viewport.right);
    viewport.height = Math.max(0, viewport.bottom - viewport.top);
    viewport.width = Math.max(0, viewport.right - viewport.left);
    return viewport;
  }

  private atLanding(root: HTMLElement, viewport: Rect, target: string, previous: number | undefined): boolean {
    const atTail = Math.abs(root.scrollHeight - root.clientHeight - root.scrollTop) <= 1 / window.devicePixelRatio;
    if (target === 'latest') return atTail;
    const row = [...root.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (node) => this.entries.kind(node.dataset.messageId!) === 'user' && this.entries.message(node.dataset.messageId!) === target,
    );
    const rect = row?.closest('[data-timeline-key]')?.getBoundingClientRect();
    return (
      rect !== undefined &&
      (Math.abs(rect.top - viewport.top - 12) <= 0.5 ||
        (atTail &&
          previous !== undefined &&
          Math.abs(root.scrollTop - previous) <= 1 / window.devicePixelRatio &&
          rect.bottom > viewport.top &&
          rect.top < viewport.bottom))
    );
  }

  private read(time: number): Frame {
    const root = scroller();
    const viewport = this.viewport(root);
    const surface = root.closest('.isolate');
    const rows: RowRect[] = [];
    const sentinels: Sentinel[] = [];
    let sizeChanges = 0;
    let unmeasured = 0;
    const changes: RowChange[] = [];
    const mounts: Mount[] = [];
    const keys = new Set<string>();
    for (const node of root.querySelectorAll<HTMLElement>('[data-timeline-key]')) {
      const key = node.dataset.timelineKey!;
      const outer = node.parentElement!;
      const rect = box(outer.getBoundingClientRect());
      rows.push({
        key,
        rect,
        content: box(node.getBoundingClientRect()),
        signature: this.signatures!.get(node),
        live: node.querySelector('[data-live-run], .animate-breathe') !== null,
      });
      const held = this.measured.get(key);
      if (this.sampleState !== null && !this.sampleState.measured.has(key)) this.sampleState.measured.set(key, held);
      const same = held !== undefined && held.height === rect.height && held.width === rect.width;
      const remount = !this.previousKeys.has(key);
      const observed: RowChange = {
        key,
        kind: this.entries.kind(key),
        before: held?.height ?? null,
        after: rect.height,
        beforeWidth: held?.width ?? null,
        afterWidth: rect.width,
        remount,
        frame: this.count(),
      };
      if (held !== undefined && !same) {
        sizeChanges += 1;
        changes.push(observed);
      }
      const measured = held !== undefined && held.stable >= 2 && same;
      if (remount) mounts.push({ ...observed, measured });
      if (remount && !measured) unmeasured += 1;
      const ready = [...node.querySelectorAll('img')].every((image) => image.complete);
      this.measured.set(key, { height: rect.height, width: rect.width, stable: ready ? (same ? held.stable + 1 : 1) : 0 });
      keys.add(key);
      if (rect.bottom <= viewport.top || rect.top >= viewport.bottom || rect.right <= viewport.left || rect.left >= viewport.right)
        continue;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
        acceptNode: (text) =>
          text.textContent?.trim() && !text.parentElement?.closest('button, [aria-hidden="true"]')
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
      });
      const blocks = new Set<Element>();
      for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
        const block =
          text.parentElement!.closest('p, pre, h1, h2, h3, h4, li, td, th, blockquote, [data-message-id]') ?? text.parentElement!;
        if (blocks.has(block)) continue;
        blocks.add(block);
        const blockRect = block.getBoundingClientRect();
        if (blockRect.bottom <= viewport.top || blockRect.top >= viewport.bottom) continue;
        const range = document.createRange();
        const content = text.textContent ?? '';
        const start = content.search(/\S/);
        if (start < 0) continue;
        range.setStart(text, start);
        range.setEnd(text, Math.min(content.length, start + 1));
        const textRect = range.getBoundingClientRect();
        if (textRect.height === 0 || textRect.width === 0) continue;
        let id = this.identities.get(text);
        if (id === undefined) {
          id = ++this.identity;
          this.identities.set(text, id);
        }
        sentinels.push({ id, row: key, rect: box(textRect), text: content.trim().slice(0, 80) });
      }
    }
    this.previousKeys = keys;
    rows.sort((a, b) => a.rect.top - b.rect.top);
    const status = root.querySelector('[data-live-run]')?.closest<HTMLElement>('[data-timeline-key]')?.dataset.timelineKey;
    const atStatus = rows.findIndex((row) => row.key === status);
    const growing = rows[atStatus - 1];
    if (growing !== undefined && ['assistant', 'reasoning', 'tool', 'activity'].includes(this.entries.kind(growing.key)))
      growing.live = true;
    const list = root.querySelector<HTMLElement>('[data-timeline-key]')?.parentElement?.parentElement;
    const listRect = list?.getBoundingClientRect();
    const start = Math.max(viewport.top, listRect?.top ?? viewport.top);
    const tail = rows.find((row) => this.entries.tail(row.key));
    const end = Math.min(viewport.bottom, tail?.rect.bottom ?? listRect?.bottom ?? viewport.bottom);
    let covered = start;
    let blank = 0;
    for (const row of rows) {
      if (row.rect.bottom <= start || row.rect.top >= end) continue;
      const top = Math.max(start, row.rect.top);
      if (top > covered) blank += top - covered;
      covered = Math.max(covered, Math.min(end, row.rect.bottom));
    }
    blank += Math.max(0, end - covered);
    const visible = Math.max(1, viewport.height);
    const tailGap = Math.max(0, root.scrollHeight - root.clientHeight - root.scrollTop);
    if (tailGap < 1) this.endGap = 0;
    const fixed = Math.min(100, visible / 2);
    const line = viewport.top + visible - 1 + (fixed - visible + 1) * Math.min(1, this.endGap / visible);
    const under = rows.findLast((row) => row.rect.top <= line);
    const geometry = this.selected ?? (under === undefined ? null : this.entries.message(under.key));
    if (this.command !== null) {
      const landed = this.atLanding(root, viewport, this.command.target, this.lastSample?.scrollTop);
      this.landingHits = landed ? this.landingHits + 1 : 0;
      if (this.landingHits >= 2) {
        this.command.toFrame = this.count();
        this.command = null;
        this.ownMovement = false;
        this.anchorRow = null;
      }
    }
    const previous = this.lastSample;
    const structure =
      sizeChanges > 0 ||
      (previous !== null &&
        (previous.mutation !== this.mutation ||
          previous.scrollHeight !== root.scrollHeight ||
          previous.viewport.width !== viewport.width ||
          previous.viewport.height !== viewport.height));
    const controlRowNode =
      this.controlRow === null ? null : root.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(this.controlRow)}"]`);
    const controlNode = this.controlNode?.isConnected
      ? this.controlNode
      : (controlRowNode?.querySelectorAll('[aria-expanded]')[this.controlIndex] ??
        surface?.querySelector('[data-stand-disclosure="target"]'));
    const control = controlNode?.getBoundingClientRect();
    const controlExpanded = controlNode?.getAttribute('aria-expanded') ?? null;
    const controlAnimating =
      controlRowNode
        ?.getAnimations({ subtree: true })
        .some(
          (animation) =>
            (animation.playState === 'running' || animation.pending) && Number.isFinite(animation.effect?.getComputedTiming().endTime),
        ) ?? false;
    const holdingStill = this.activeDrag !== null && !this.activeEnded && this.activeDrag.distance === 0 && this.activeDrag.speed === 0;
    const movingAnchor = !holdingStill && (this.ownMovement || this.touching || (this.activeDrag !== null && !this.activeEnded));
    if (this.controlRow !== null && control !== undefined) {
      this.anchorKind = 'disclosure';
      this.anchorRow = this.controlRow;
    } else if (this.anchorRow === null || movingAnchor || this.anchorKind === 'disclosure') {
      const atTail = root.scrollHeight - root.clientHeight - root.scrollTop <= 0.5;
      const row = atTail ? tail : rows.find((row) => row.rect.bottom > viewport.top && row.rect.top < viewport.bottom);
      this.anchorKind = atTail ? 'following' : 'paused';
      this.anchorRow = row?.key ?? null;
    }
    if (this.anchorKind === 'following') this.anchorRow = tail?.key ?? null;
    const anchorRect = this.anchorKind === 'disclosure' ? control : rows.find((row) => row.key === this.anchorRow)?.rect;
    const anchor: Anchor | null =
      this.anchorRow === null || anchorRect === undefined ? null : { kind: this.anchorKind, row: this.anchorRow, rect: box(anchorRect) };
    const navigation = root.parentElement?.querySelector('[role="navigation"]');
    const rail =
      navigation !== null && navigation !== undefined && [...navigation.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0);
    const sampled: Frame = {
      time,
      sampled: performance.now(),
      dpr: window.devicePixelRatio,
      scrollTop: root.scrollTop,
      scrollHeight: root.scrollHeight,
      viewport,
      rows,
      sentinels,
      blank,
      rail,
      tiles: navigation?.querySelectorAll('button').length ?? 0,
      gold: message(navigation?.querySelector('[aria-current="location"]')?.getAttribute('aria-label') ?? null),
      geometry,
      line,
      selected: this.selected,
      mutation: this.mutation,
      sizeChanges,
      unmeasured,
      moving: this.ownMovement,
      touching: this.touching,
      finger: this.finger,
      structure,
      control: control === undefined ? null : box(control),
      controlRow: this.controlRow,
      controlExpanded,
      controlAnimating,
      disclosure: this.layout(controlNode?.closest('[data-timeline-key]')),
      anchor,
      changes,
      mounts,
    };
    this.lastSample = sampled;
    return sampled;
  }
}
