import type { Disposition, Page } from '@tagma/server/browser/contract/wire/page';
import { Host, type HostKind } from '@runlith/layer/Host';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import { TabLayouts } from '$lib/app/panes/TabLayouts.svelte.js';
import { type PlacesPort, ThreadPlaces } from '$lib/app/panes/ThreadPlaces.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { BROWSER_PANE, browserPane, shownId } from './panes.js';
import { ProjectPages } from './ProjectPages.svelte.js';

export class OpenPages extends Service<OpenPages>()('OpenPages', { tier: 'project', eager: true }) {
  static *make() {
    const pages = new OpenPages(
      yield* ProjectRung.Current,
      yield* Live,
      yield* ThreadPlaces,
      yield* TabLayouts,
      yield* SidePanes,
      (yield* Host).kind,
    );
    (yield* Scope).defer(() => pages.listing.close());
    return pages;
  }

  readonly listing: ProjectPages;

  constructor(
    readonly aim: ProjectAim,
    live: LiveConnection,
    private readonly seats: PlacesPort,
    private readonly layouts: TabLayouts,
    private readonly sides: SidePanes,
    private readonly host: HostKind,
  ) {
    super();
    this.listing = new ProjectPages(live, aim.projectId, { opened: (page, disposition) => this.opened(page, disposition) });
  }

  private opened(page: Page, disposition: Disposition | undefined): void {
    if (this.host === 'mobile') return;
    if (disposition !== undefined && disposition !== 'window' && this.beside(page, disposition)) return;
    if (page.openedBy === null) return;
    this.seats.openFor(this.layouts, page.openedBy, browserPane({ project: this.aim.projectId, page: page.id }), {
      activate: false,
      agent: true,
    });
  }

  private beside(page: Page, disposition: Exclude<Disposition, 'window'>): boolean {
    const project = this.aim.projectId;
    const opener = page.opener;
    if (opener === null) return false;
    const tabs = this.sides.panes;
    const at = tabs.findIndex((tab) => tab.kind === BROWSER_PANE && tab.id === shownId({ project, page: opener }));
    if (at < 0) return false;
    const agent = (this.listing.byId.get(opener)?.live.driven ?? null) !== null;
    const front = disposition === 'tab' && !agent && this.sides.showing && this.sides.active?.key === tabs[at]!.key;
    const placed = this.sides.open(browserPane({ project, page: page.id }), { activate: front, agent });
    if (placed.kind === 'opened') this.sides.move(placed.key, tabs[at + 1]?.key ?? null);
    return placed.kind !== 'refused';
  }
}
