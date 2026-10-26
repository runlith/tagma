import { getContext, setContext, untrack } from 'svelte';

export type Part = { readonly title: string; readonly heading: HTMLElement };

const PARTS = Symbol('settings.parts');
const READER_INPUT = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const;

export class SettingsParts {
  list = $state.raw<readonly Part[]>([]);
  current = $state(0);

  private readonly room = new WeakMap<HTMLElement, number>();
  private pane: HTMLElement | null = null;
  private held: Part | null = null;
  private frame = 0;

  add(part: Part): () => void {
    this.room.set(part.heading, Number.parseFloat(getComputedStyle(part.heading).scrollMarginTop) || 0);
    untrack(() => {
      this.list = [...this.list, part].sort(byPlace);
    });
    return () => {
      untrack(() => {
        this.list = this.list.filter((one) => one !== part);
      });
    };
  }

  watch(pane: HTMLElement): () => void {
    this.pane = pane;
    const scrolled = (): void => this.schedule();
    const release = (): void => {
      this.held = null;
    };
    pane.addEventListener('scroll', scrolled, { passive: true });
    for (const kind of READER_INPUT) pane.addEventListener(kind, release, { passive: true });
    this.schedule();
    return () => {
      pane.removeEventListener('scroll', scrolled);
      for (const kind of READER_INPUT) pane.removeEventListener(kind, release);
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.pane = null;
    };
  }

  schedule(): void {
    if (this.frame !== 0 || this.pane === null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.follow();
    });
  }

  reach(part: Part): void {
    this.held = part;
    this.current = Math.max(0, this.list.indexOf(part));
    part.heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  private follow(): void {
    const pane = this.pane;
    if (pane === null) return;
    if (this.held !== null) {
      const at = this.list.indexOf(this.held);
      if (at >= 0) {
        this.current = at;
        return;
      }
      this.held = null;
    }
    const top = pane.getBoundingClientRect().top;
    let at = 0;
    for (const [index, part] of this.list.entries()) {
      if (part.heading.getBoundingClientRect().top > top + (this.room.get(part.heading) ?? 0) + 1) break;
      at = index;
    }
    if (pane.scrollTop > 0 && pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1) at = this.list.length - 1;
    this.current = Math.max(0, at);
  }
}

function byPlace(left: Part, right: Part): number {
  return left.heading.compareDocumentPosition(right.heading) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

export function standParts(parts: SettingsParts): void {
  setContext(PARTS, parts);
}

export function partsHere(): SettingsParts | undefined {
  return getContext<SettingsParts | undefined>(PARTS);
}
