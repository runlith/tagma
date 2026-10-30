<script lang="ts">
  import type { MarketplaceRow } from '@tagma/server/marketplaces/contract/wire/rows';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import { agoSaid } from '$lib/shared/time.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import type { Told } from '$lib/wire/told.js';
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';
  import { LABELS } from '$lib/features/plugins/words.js';

  let { marketplace, onremoved }: { marketplace: MarketplaceRow; onremoved: () => void } = $props();

  const repo = PluginsRepo.use();

  let busy = $state<'refresh' | 'remove' | null>(null);
  let failed = $state<Told | undefined>(undefined);

  const fetched = $derived(
    marketplace.revision === null
      ? 'Not fetched yet'
      : `${marketplace.entries} ${marketplace.entries === 1 ? 'plugin' : 'plugins'}, fetched ${agoSaid(marketplace.revision.fetched)}`,
  );

  async function act(doing: 'refresh' | 'remove'): Promise<void> {
    busy = doing;
    failed = undefined;
    try {
      if (doing === 'refresh') await repo.refreshMarketplace.run({ id: marketplace.id }, { throwOnError: true });
      else {
        await repo.removeMarketplace.run({ id: marketplace.id }, { throwOnError: true });
        onremoved();
      }
    } catch (error: unknown) {
      failed = toldOf(error);
    } finally {
      busy = null;
    }
  }
</script>

<header class="grid gap-3">
  <div class="flex min-w-0 items-center gap-3">
    <div class="grid min-w-0 flex-1 gap-0.5">
      <div class="flex min-w-0 items-baseline gap-2">
        <FadeText text={marketplace.title} class="text-title font-semibold" />
        {#if marketplace.label === 'unreviewed'}
          <span class="shrink-0 rounded-sm border px-1.5 text-meta text-muted-foreground">{LABELS.unreviewed}</span>
        {/if}
      </div>
      <span class="text-small text-muted-foreground tabular">{fetched}</span>
    </div>
    <Button variant="outline" size="sm" disabled={busy !== null} onclick={() => void act('refresh')}>
      {busy === 'refresh' ? 'Refreshing…' : 'Refresh'}
    </Button>
    <Button variant="outline" size="sm" disabled={busy !== null} onclick={() => void act('remove')}>Remove</Button>
  </div>
  {#if marketplace.description !== null && marketplace.description !== ''}
    <p class="max-w-prose text-ui text-muted-foreground">{marketplace.description}</p>
  {/if}
  {#if marketplace.source.kind === 'folder'}
    <PathText path={marketplace.source.path} class="stamp text-muted-foreground" />
  {:else}
    <FadeText text={marketplace.source.url} class="stamp text-muted-foreground" />
  {/if}
  {#if marketplace.failure !== null}
    <Callout
      tone="error"
      title="The last refresh failed {agoSaid(marketplace.failure.at)}; the stored list stays"
      note={marketplace.failure.reason}
    />
  {/if}
  {#if failed !== undefined}<Callout tone="error" title={failed.text} note={failed.note} />{/if}
</header>
