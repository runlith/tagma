import { Router } from '@runlith/layer/Router';
import { Service } from '@runlith/layer/key';
import type { ScreenThreads } from '$lib/features/threads/OnScreen.svelte.js';
import type { ThreadSlot } from '$lib/features/threads/ThreadSlot.svelte.js';
import { Claims } from '$lib/shared/Claims.svelte.js';

export class Screen extends Service<Screen>()('Screen', { tier: 'app' }) implements ScreenThreads {
  static *make() {
    return new Screen(yield* Router);
  }

  private readonly pages = new Claims<ThreadSlot>();

  readonly mainFocused = true;

  private entered: number | undefined;

  constructor(private readonly router: Router) {
    super();
  }

  get page(): ThreadSlot | null {
    return this.pages.current;
  }

  get host(): ThreadSlot | null {
    return this.pages.current;
  }

  get shown(): readonly ThreadSlot[] {
    const page = this.pages.current;
    return page === null ? [] : [page];
  }

  seat(page: ThreadSlot): () => void {
    return this.pages.take(page);
  }

  enter(): void {
    this.entered = this.router.historyIndex;
  }

  back(parent: string): void {
    const at = this.router.historyIndex;
    if (this.entered !== undefined && at !== undefined && at > this.entered) this.router.traverse(-1);
    else void this.router.goto(parent, { replaceState: true });
  }

  activation(): number {
    return 0;
  }
}
