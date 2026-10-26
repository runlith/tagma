import { SvelteMap } from 'svelte/reactivity';

const OPEN_AFTER_MS = 450;
const CLOSE_AFTER_MS = 160;

export class ThreadPeeks {
  openId = $state<string | null>(null);
  keyed = $state<string | null>(null);
  private readonly acting = new SvelteMap<string, string>();
  private opening: { readonly id: string; readonly timer: ReturnType<typeof setTimeout> } | null = null;
  private closing: ReturnType<typeof setTimeout> | null = null;
  private spent: string | null = null;

  key(threadId: string): string {
    return `${threadId}#row`;
  }

  workKey(threadId: string): string {
    return `${threadId}#work`;
  }

  press(id: string): void {
    this.cancelOpen();
    this.cancelClose();
    if (this.openId === id) this.openId = null;
    this.spent = threadOf(id);
  }

  hover(id: string): void {
    const thread = threadOf(id);
    if (this.spent === thread) return;
    this.spent = null;
    if (this.openId !== null && this.keyed === this.openId && this.openId !== id) return;
    if (this.openId === id) {
      this.cancelClose();
      return;
    }
    this.cancelOpen();
    const timer = setTimeout(() => {
      this.opening = null;
      this.cancelClose();
      this.openId = id;
      this.keyed = null;
    }, OPEN_AFTER_MS);
    this.opening = { id, timer };
  }

  leave(id: string): void {
    if (this.spent === threadOf(id)) this.spent = null;
    if (this.opening?.id === id) this.cancelOpen();
    if (this.openId !== id || this.keyed === id) return;
    this.cancelClose();
    this.closing = setTimeout(() => {
      this.closing = null;
      if (this.openId === id && this.keyed !== id) this.openId = null;
    }, CLOSE_AFTER_MS);
  }

  hold(): void {
    this.cancelClose();
  }

  toggle(id: string): void {
    this.cancelOpen();
    this.cancelClose();
    if (this.openId === id) {
      this.openId = null;
      return;
    }
    this.openId = id;
    this.keyed = id;
  }

  close(id: string): void {
    if (this.opening?.id === id) this.cancelOpen();
    if (this.openId !== id) return;
    this.cancelClose();
    this.openId = null;
  }

  dismiss(): void {
    this.cancelOpen();
    this.cancelClose();
    this.openId = null;
  }

  busy(threadId: string): boolean {
    return this.acting.has(threadId);
  }

  pressed(threadId: string): string | null {
    return this.acting.get(threadId) ?? null;
  }

  async act(threadId: string, act: string, run: () => Promise<void>): Promise<void> {
    if (this.acting.has(threadId)) return;
    this.acting.set(threadId, act);
    try {
      await run();
    } finally {
      this.acting.delete(threadId);
    }
  }

  private cancelOpen(): void {
    if (this.opening !== null) clearTimeout(this.opening.timer);
    this.opening = null;
  }

  private cancelClose(): void {
    if (this.closing !== null) clearTimeout(this.closing);
    this.closing = null;
  }
}

function threadOf(id: string): string {
  const mark = id.lastIndexOf('#');
  return mark < 0 ? id : id.slice(0, mark);
}

export const threadPeeks = new ThreadPeeks();
