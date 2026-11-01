import { Service } from '@runlith/layer/key';
import { Router } from '@runlith/layer/Router';
import { McpFeed } from '$lib/features/mcp/Feed.js';
import { McpRepo } from '$lib/features/mcp/Repo.js';
import { SecretsRepo } from '$lib/features/secrets/Repo.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { refusalOf } from '$lib/wire/refusal.js';
import { categoriesOf, listingsOf } from './catalog.js';
import { MarketplacesFeed } from './Feed.svelte.js';
import { hereOf } from './here.js';
import { PLUGINS, placeOf } from './place.js';
import { PluginsRepo } from './Repo.js';

export class PluginsPlace extends Service<PluginsPlace>()('PluginsPlace', { tier: 'project' }) {
  static *make() {
    return new PluginsPlace(
      yield* PluginsRepo,
      yield* McpRepo,
      yield* SecretsRepo,
      yield* MarketplacesFeed,
      yield* McpFeed,
      yield* Workspace,
      yield* Addresses,
      yield* Router,
      (yield* ProjectRung.Current).projectId,
    );
  }

  adding = $state(false);

  constructor(
    private readonly plugins: PluginsRepo,
    private readonly mcp: McpRepo,
    private readonly secrets: SecretsRepo,
    readonly feed: MarketplacesFeed,
    private readonly serversFeed: McpFeed,
    private readonly workspace: Workspace,
    private readonly addresses: Addresses,
    private readonly router: Router,
    readonly projectId: number,
  ) {
    super();
  }

  readonly project = $derived.by(() => this.workspace.find(this.projectId));
  readonly opened = $derived.by(() => {
    const id = this.router.params.id;
    return typeof id === 'string' && id !== '' ? id : null;
  });
  readonly place = $derived(placeOf(this.opened));

  hrefOf(id: string | null): string {
    return this.project === null ? '' : this.addresses.place(this.project.name, PLUGINS, id, null);
  }

  go(id: string | null): void {
    void this.router.goto(this.hrefOf(id));
  }

  readonly listed = $derived.by(() => this.plugins.plugins.key(this.projectId));
  readonly served = $derived.by(() => this.mcp.servers.key(this.projectId));
  readonly rows = $derived(this.listed.data ?? []);
  readonly servers = $derived(this.served.data ?? []);
  readonly pluginsFailure = $derived(this.listed.error == null ? null : refusalOf(this.listed.error).reason);
  readonly serversFailure = $derived(this.served.error == null ? null : refusalOf(this.served.error).reason);
  readonly failure = $derived(
    [this.pluginsFailure, this.serversFailure].filter((reason): reason is string => reason !== null).join(' ') || null,
  );
  readonly listings = $derived.by(() => listingsOf(this.feed.marketplaces, this.feed.entries));
  readonly categories = $derived(categoriesOf(this.listings));
  readonly here = $derived.by(() => hereOf(this.rows, this.servers, this.feed.entries));

  hold(): () => void {
    const marketplaces = this.feed.hold();
    const servers = this.serversFeed.hold(this.projectId);
    return () => {
      marketplaces();
      servers();
    };
  }

  async refresh(): Promise<void> {
    await Promise.all([
      this.listed.refresh(),
      this.served.refresh(),
      this.secrets.sets.key({ projectId: this.projectId, owner: 'plugins' }).refresh(),
    ]);
  }
}
