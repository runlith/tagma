import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Router } from '@runlith/layer/Router';
import { Service } from '@runlith/layer/key';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { CHAT } from '$lib/features/workspace/surface.js';
import { type DraftPlace, MAIN_CHECKOUT } from './Draft.svelte.js';
import { DraftShelf } from './native/DraftShelf.svelte.js';
import { unbornKey } from './SlotSelection.svelte.js';

export class PageDraft extends Service<PageDraft>()('PageDraft', { tier: 'app' }) {
  static *make() {
    return new PageDraft(yield* DraftShelf, yield* SidePanes, yield* Router, yield* Addresses);
  }

  constructor(
    private readonly shelf: DraftShelf,
    private readonly panes: SidePanes,
    private readonly router: Router,
    private readonly addresses: Addresses,
  ) {
    super();
  }

  start(project: Project, place: DraftPlace = MAIN_CHECKOUT, branch: string | null = null): void {
    this.shelf.place(unbornKey(project.id), place);
    this.panes.focusOn(null);
    void this.router.goto(this.addresses.place(project.name, CHAT, null, branch));
  }
}
