import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { Disposition, Page, PagesEvent } from '@tagma/server/browser/contract/wire/page';
import { SvelteMap } from 'svelte/reactivity';
import type { LiveConnection } from '$lib/wire/Live.js';

export type PagesOptions = { readonly opened?: (page: Page, disposition: Disposition | undefined) => void };

export class ProjectPages {
  readonly byId = new SvelteMap<PageId, Page>();

  listed = $state(false);

  failure = $state<string | null>(null);

  private readonly held: { unsubscribe: () => void };

  constructor(
    live: LiveConnection,
    projectId: number,
    private readonly options: PagesOptions = {},
  ) {
    this.held = live.hold(
      (client) => client['browser.pages']({ projectId }),
      (event) => this.take(event),
      (failure) => {
        this.failure = failure.message;
      },
    );
  }

  get pages(): readonly Page[] {
    return [...this.byId.values()].sort((left, right) => right.activeAt.localeCompare(left.activeAt));
  }

  close(): void {
    this.held.unsubscribe();
  }

  private take(event: PagesEvent): void {
    this.failure = null;
    switch (event.type) {
      case 'list':
        this.byId.clear();
        for (const page of event.pages.toSorted((one, other) => (one.id < other.id ? -1 : one.id > other.id ? 1 : 0)))
          this.byId.set(page.id, page);
        this.listed = true;
        return;
      case 'put': {
        const fresh = this.listed && !this.byId.has(event.page.id);
        this.byId.set(event.page.id, event.page);
        if (fresh) this.options.opened?.(event.page, event.disposition);
        return;
      }
      case 'gone':
        this.byId.delete(event.id);
        return;
    }
  }
}
