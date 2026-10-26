<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { AdaptersRepo } from './AdaptersRepo.js';
  import AdapterRow from './Row.svelte';

  const notices = Notices.use();
  const catalog = ProviderCatalog.use();
  const adapters = AdaptersRepo.use();

  const installed = $derived(catalog.served.adapters.filter((adapter) => adapter.origin === 'machine'));
  const bundled = $derived(catalog.served.adapters.filter((adapter) => adapter.origin !== 'machine'));
  const unwell = $derived(bundled.filter((adapter) => adapter.state === 'failed'));
  const resting = $derived(bundled.filter((adapter) => adapter.state !== 'failed'));

  let source = $state('');
  let adding = $state(false);
  let showBundled = $state(false);

  async function add(): Promise<void> {
    const named = source.trim();
    if (named === '') return;
    adding = true;
    try {
      await adapters.install.run(named, { throwOnError: true });
      source = '';
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      adding = false;
    }
  }
</script>

<section class="@container overflow-hidden rounded-lg border bg-raised" aria-label="Adapters" data-adapters>
  <div class="flex min-h-9 items-center gap-2 px-3 py-1">
    <h3 class="text-ui font-semibold">Adapters</h3>
    <span class="text-ui text-muted-foreground">add a provider from an npm package, a GitHub repository or a local directory</span>
  </div>

  <form
    class="flex items-center gap-2 border-t border-border px-3 py-2"
    onsubmit={(event) => {
      event.preventDefault();
      void add();
    }}
  >
    <Input
      bind:value={source}
      class="min-w-0 flex-1 font-mono"
      placeholder="@scope/adapter, https://github.com/owner/repo or /path/to/adapter"
      aria-label="Adapter source"
      disabled={adding}
      autocomplete="off"
      spellcheck={false}
    />
    <Button type="submit" variant="outline" size="sm" disabled={adding || source.trim() === ''}>
      <Plus class="size-3.5" />
      {adding ? 'Installing…' : 'Add'}
    </Button>
  </form>

  {#each installed as adapter (adapter.id)}
    <AdapterRow {adapter} />
  {/each}
  {#if installed.length === 0}
    <p class="border-t border-border px-3 py-2 text-ui text-muted-foreground">No adapter is installed from outside yet.</p>
  {/if}

  {#each unwell as adapter (adapter.id)}
    <AdapterRow {adapter} />
  {/each}

  {#if resting.length > 0}
    <button
      type="button"
      class="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-ui text-muted-foreground hover:bg-hover"
      aria-expanded={showBundled}
      onclick={() => (showBundled = !showBundled)}
    >
      {#if showBundled}<ChevronDown class="size-3.5" />{:else}<ChevronRight class="size-3.5" />{/if}
      Built in and shipped with this release ({resting.length})
    </button>
    {#if showBundled}
      {#each resting as adapter (adapter.id)}
        <AdapterRow {adapter} />
      {/each}
    {/if}
  {/if}
</section>
