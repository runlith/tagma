<script lang="ts">
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';

  let { provider }: { provider: string } = $props();

  const notices = Notices.use();
  const accounts = AccountsRepo.use();
  const catalog = ProviderCatalog.use();

  async function refresh(): Promise<void> {
    try {
      const next = await accounts.refreshModels.run({ provider }, { throwOnError: true });
      if (next) catalog.adopt(next);
    } catch (error: unknown) {
      notices.refusal(error);
    }
  }
</script>

<Button variant="ghost" size="sm" disabled={accounts.refreshModels.pending} onclick={() => void refresh()}>
  <RefreshCw class="size-3.5" /> Refresh models
</Button>
