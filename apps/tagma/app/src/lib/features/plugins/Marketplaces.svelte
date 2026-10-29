<script lang="ts">
  import type { MarketplaceRow } from '@tagma/server/marketplaces/contract/wire/rows';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import { agoSaid } from '$lib/shared/time.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import type { Told } from '$lib/wire/told.js';
  import { PluginsRepo } from '$lib/features/plugins/Repo.js';
  import { LABELS } from '$lib/features/plugins/words.js';

  let { marketplaces }: { marketplaces: readonly MarketplaceRow[] } = $props();

  const repo = PluginsRepo.use();

  let source = $state('');
  let busy = $state<string | null>(null);
  let failed = $state<{ readonly at: string; readonly told: Told } | undefined>(undefined);

  async function act(at: string, doing: string, work: () => Promise<unknown>): Promise<boolean> {
    busy = doing;
    failed = undefined;
    try {
      await work();
      return true;
    } catch (error: unknown) {
      failed = { at, told: toldOf(error) };
      return false;
    } finally {
      busy = null;
    }
  }

  async function add(): Promise<void> {
    const from = source.trim();
    if (await act('', 'add', () => repo.addMarketplace.run({ source: from }, { throwOnError: true }))) source = '';
  }
</script>

{#snippet refused(at: string)}
  {#if failed !== undefined && failed.at === at}
    <Callout tone="error" title={failed.told.text} note={failed.told.note} />
  {/if}
{/snippet}

<div class="grid gap-3 pt-1">
  <form
    class="flex items-center gap-2"
    onsubmit={(event) => {
      event.preventDefault();
      if (source.trim() !== '') void add();
    }}
  >
    <Input class="font-mono" placeholder="A marketplace's git URL or folder" bind:value={source} disabled={busy !== null} />
    <Button size="sm" type="submit" disabled={busy !== null || source.trim() === ''}>{busy === 'add' ? 'Adding…' : 'Add'}</Button>
  </form>
  {@render refused('')}

  {#if marketplaces.length > 0}
    <ul class="divide-y overflow-hidden rounded-lg border bg-raised">
      {#each marketplaces as marketplace (marketplace.id)}
        <li class="grid gap-1.5 px-3 py-2" aria-label={marketplace.title} data-marketplace={marketplace.id}>
          <div class="flex min-w-0 items-center gap-2">
            <FadeText text={marketplace.title} class="text-ui font-semibold" />
            <span class="eyebrow shrink-0 rounded-md bg-selected px-1.5 py-0.5 text-muted-foreground">{LABELS[marketplace.label]}</span>
            <FadeText
              text={marketplace.revision === null
                ? 'not fetched yet'
                : `${marketplace.entries} ${marketplace.entries === 1 ? 'plugin' : 'plugins'}, fetched ${agoSaid(marketplace.revision.fetched)}`}
              class="flex-1 text-small text-muted-foreground tabular"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onclick={() =>
                void act(marketplace.id, `refresh:${marketplace.id}`, () =>
                  repo.refreshMarketplace.run({ id: marketplace.id }, { throwOnError: true }),
                )}
            >
              {busy === `refresh:${marketplace.id}` ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onclick={() =>
                void act(marketplace.id, `remove:${marketplace.id}`, () =>
                  repo.removeMarketplace.run({ id: marketplace.id }, { throwOnError: true }),
                )}
            >
              Remove
            </Button>
          </div>
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
          {@render refused(marketplace.id)}
        </li>
      {/each}
    </ul>
  {/if}
</div>
