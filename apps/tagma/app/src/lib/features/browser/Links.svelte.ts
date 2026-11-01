import { openLinks } from '@tagma/server/browser/contract/wire/settings';
import { Service } from '@runlith/layer/key';
import { ExternalLinks, type LinkPort } from '$lib/shared/ExternalLinks.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { SettingsRepo, writtenCatalog } from '$lib/features/settings/SettingsRepo.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Door } from '$lib/wire/Door.js';
import { Refusal } from '$lib/wire/refusal.js';
import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import { Beside, type BesidePort } from '$lib/features/opening/Beside.js';
import type { LinkFrom } from '$lib/features/opening/Link.js';
import type { SidePane } from '$lib/shared/panes/pane.js';
import { BROWSER_PANE, browserPane, shownOf } from './panes.js';

export type BesidePage = {
  readonly fresh?: boolean | undefined;
  readonly urlOf?: ((page: PageId) => string | undefined) | undefined;
  readonly from?: LinkFrom | undefined;
};

export type LinkRoute = 'panel' | 'system';

const sameUrl = (one: string | undefined, two: string): boolean =>
  one !== undefined && URL.canParse(one) && new URL(one).href === new URL(two).href;

export class Links extends Service<Links>()('Links', { tier: 'app' }) {
  static *make() {
    return new Links(yield* Door, yield* Beside, yield* ProjectRung.Source, yield* SettingsRepo, yield* Notices, yield* ExternalLinks);
  }

  constructor(
    private readonly door: Door,
    private readonly placing: BesidePort,
    private readonly project: () => ProjectAim | undefined,
    private readonly settings: SettingsRepo,
    private readonly notices: Notices,
    private readonly external: LinkPort,
  ) {
    super();
  }

  get panelled(): boolean {
    const projectId = this.project()?.projectId;
    if (projectId === undefined) return false;
    const entries = (writtenCatalog(this.settings, projectId) ?? this.settings.catalog.key(projectId).data)?.entries;
    const chosen = entries?.find((entry) => entry.id === openLinks.id)?.value;
    return typeof chosen === 'boolean' ? chosen : openLinks.fallback;
  }

  system(url: string): void {
    this.external.open(url);
  }

  async beside(url: string, ask: BesidePage = {}): Promise<LinkRoute> {
    const projectId = this.project()?.projectId ?? null;
    if (projectId === null || !this.panelled) {
      this.external.open(url);
      return 'system';
    }
    const fresh = ask.fresh === true;
    const urlOf = ask.urlOf ?? (() => undefined);
    const sought = this.placing.seek({
      kind: BROWSER_PANE,
      from: ask.from,
      match: (pane) => {
        const shown = fresh || pane.kind !== BROWSER_PANE ? null : shownOf(pane.id);
        return shown !== null && shown.project === projectId && sameUrl(urlOf(shown.page), url);
      },
    });
    if (sought === 'shown') return 'panel';
    if (sought === 'absent') {
      try {
        const { page } = await this.door.perform('open_page', { url }, { project: String(projectId) });
        const standing = fresh
          ? undefined
          : (tabs: readonly SidePane[], active: string | null) =>
              tabs.find((tab) => tab.key === active && tab.kind === BROWSER_PANE) ?? tabs.findLast((tab) => tab.kind === BROWSER_PANE);
        if (this.placing.show({ content: browserPane({ project: projectId, page: page.id }), from: ask.from, standing })) return 'panel';
      } catch (error) {
        if (!(error instanceof Refusal && error.code === 'host-away')) this.notices.refusal(error);
      }
    }
    this.external.open(url);
    return 'system';
  }
}
