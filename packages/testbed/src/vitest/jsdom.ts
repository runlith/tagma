import cssEscape from 'css.escape';
import { vi } from 'vitest';

declare global {
  var __sveltekit_dev: { env: Record<string, string> } | undefined;
}

globalThis.__sveltekit_dev ??= { env: {} };

if (typeof window !== 'undefined') {
  const css = window.CSS ?? globalThis.CSS;
  css.escape ??= cssEscape;
  window.CSS = css;
  globalThis.CSS = css;
}

if (typeof document !== 'undefined' && document.fonts === undefined) {
  const fonts = new EventTarget();
  Object.defineProperty(document, 'fonts', {
    value: Object.assign(fonts, { ready: Promise.resolve(fonts) }),
    configurable: true,
  });
}

const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom !== undefined) {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (globalThis[name] === undefined) {
      Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
    }
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => {
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

if (typeof window !== 'undefined') {
  window.scrollTo = () => undefined;
}

if (typeof window !== 'undefined' && typeof HTMLElement !== 'undefined') {
  if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
    HTMLElement.prototype.scrollIntoView = () => undefined;
  }
}

if (typeof window !== 'undefined' && typeof window.ResizeObserver !== 'function') {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

if (typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'function') {
  window.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

if (typeof HTMLCanvasElement !== 'undefined' && typeof globalThis.CanvasRenderingContext2D === 'undefined') {
  const context = new Proxy({ measureText: (text: string) => ({ width: text.length * 8 }) } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : () => undefined),
    set: (target, key, value) => {
      target[key as string] = value;
      return true;
    },
  });
  HTMLCanvasElement.prototype.getContext = ((kind: string) =>
    kind === '2d' ? context : null) as unknown as HTMLCanvasElement['getContext'];
}

if (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.animate !== 'function') {
  const animate: typeof HTMLElement.prototype.animate = (_keyframes, options) => {
    const durationRaw = typeof options === 'number' ? options : options?.duration;
    const durationMs = typeof durationRaw === 'number' ? durationRaw : 0;

    let onfinish: ((this: Animation, ev: Event) => unknown) | null = null;

    const animation = {
      currentTime: 0,
      playState: 'running' as 'running' | 'finished' | 'idle',
      effect: null,
      cancel() {
        animation.playState = 'idle';
        onfinish = null;
      },
    };

    Object.defineProperty(animation, 'onfinish', {
      get: () => onfinish,
      set(handler: ((this: Animation, ev: Event) => unknown) | null) {
        onfinish = handler;
        queueMicrotask(() => {
          if (!onfinish) return;
          animation.currentTime = durationMs;
          animation.playState = 'finished';
          onfinish.call(animation as unknown as Animation, new Event('finish'));
        });
      },
    });

    return animation as unknown as Animation;
  };

  (HTMLElement.prototype as unknown as { animate: typeof HTMLElement.prototype.animate }).animate = animate;
}

if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = () => [];
}

if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}
