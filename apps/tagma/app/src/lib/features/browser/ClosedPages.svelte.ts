import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { Page } from '@tagma/server/browser/contract/wire/page';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { TAB_REOPEN } from '$lib/features/workspace/action.js';
import { ProjectRung, type ProjectAim } from '$lib/features/workspace/ProjectRung.js';
import { Door } from '$lib/wire/Door.js';
import { showPage } from './panes.js';

export class ClosedPages extends Service<ClosedPages>()('ClosedPages', { tier: 'project', eager: true }) {
  static *make() {
    const pages = new ClosedPages(yield* ProjectRung.Current, yield* ProjectRung.Source, yield* Door, yield* SidePanes, yield* Notices);
    (yield* Scope).defer(pages.listen(yield* Keymap));
    return pages;
  }

  listed = $state.raw<readonly Page[]>([]);

  private readonly reopened = new Set<PageId>();

  private armed = false;

  constructor(
    private readonly aim: ProjectAim,
    private readonly route: () => ProjectAim | undefined,
    private readonly door: Door,
    private readonly panes: SidePanes,
    private readonly notices: Notices,
  ) {
    super();
  }

  private get lens() {
    return { project: String(this.aim.projectId) };
  }

  async close(page: PageId): Promise<void> {
    await this.door.perform('close_page', { page }, this.lens);
    this.armed = true;
  }

  async read(): Promise<void> {
    this.listed = (await this.door.perform('list_pages', { closed: true, limit: 20 }, this.lens)).pages;
  }

  async reopen(): Promise<void> {
    await this.read();
    const last = this.listed.find((page) => !this.reopened.has(page.id) && page.url !== '' && page.url !== 'about:blank');
    if (last === undefined) {
      this.armed = false;
      return;
    }
    const opened = await this.door.perform('open_page', { url: last.url, profile: last.profile }, this.lens);
    this.reopened.add(last.id);
    showPage(this.panes, { project: this.aim.projectId, page: opened.page.id }, true);
  }

  private listen(keymap: Keymap): () => void {
    return keymap.handle(TAB_REOPEN, () => {
      if (!this.armed || this.route()?.projectId !== this.aim.projectId) return false;
      this.reopen().catch((error: unknown) => this.notices.refusal(error));
      return true;
    });
  }
}
