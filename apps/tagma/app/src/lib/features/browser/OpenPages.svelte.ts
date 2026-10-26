import type { Page } from '@tagma/server/browser/contract/wire/page';
import { Host, type HostKind } from '@runlith/layer/Host';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { TabLayouts } from '$lib/app/panes/TabLayouts.svelte.js';
import { type PlacesPort, ThreadPlaces } from '$lib/app/panes/ThreadPlaces.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { browserPane } from './panes.js';
import { ProjectPages } from './ProjectPages.svelte.js';

export class OpenPages extends Service<OpenPages>()('OpenPages', { tier: 'project', eager: true }) {
  static *make() {
    const pages = new OpenPages(yield* ProjectRung.Current, yield* Live, yield* ThreadPlaces, yield* TabLayouts, (yield* Host).kind);
    (yield* Scope).defer(() => pages.listing.close());
    return pages;
  }

  readonly listing: ProjectPages;

  constructor(
    readonly aim: ProjectAim,
    live: LiveConnection,
    private readonly seats: PlacesPort,
    private readonly layouts: TabLayouts,
    private readonly host: HostKind,
  ) {
    super();
    this.listing = new ProjectPages(live, aim.projectId, { opened: (page) => this.opened(page) });
  }

  private opened(page: Page): void {
    if (this.host === 'mobile' || page.openedBy === null) return;
    this.seats.openFor(this.layouts, page.openedBy, browserPane({ project: this.aim.projectId, page: page.id }), {
      activate: false,
      agent: true,
    });
  }
}
