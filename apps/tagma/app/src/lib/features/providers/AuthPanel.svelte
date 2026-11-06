<script lang="ts">
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
  import { ProviderCatalog } from './Catalog.svelte.js';
  import ConsoleKeyGroup from './auth/ConsoleKeyGroup.svelte';
  import SpeechKeyGroup from './auth/SpeechKeyGroup.svelte';
  import ProviderGroup from './Group.svelte';
  import Failed from './Failed.svelte';
  import InstanceSection from './instances/Section.svelte';
  import AccountRow from './accounts/Row.svelte';
  import { UsageAccounts } from './usage/Accounts.svelte.js';

  let { projectId = null }: { projectId?: number | null } = $props();

  const notices = Notices.use();
  const accounts = AccountsRepo.use();
  const catalog = ProviderCatalog.use();
  const usage = UsageAccounts.use();

  type CacheLifetime = NonNullable<Awaited<ReturnType<typeof accounts.cacheLifetime.loadOrThrow>>>[number];

  const uninstalled = $derived(
    [...new Set(usage.rows.filter((row) => row.problem?.kind === 'not-installed').map((row) => row.provider))].map((provider) => ({
      provider,
      rows: usage.of(provider),
    })),
  );

  let lifetimes = $state<readonly CacheLifetime[]>([]);
  $effect(() => {
    let listening = true;
    void accounts.cacheLifetime
      .refresh({ throwOnError: true })
      .then((read) => {
        if (listening && read) lifetimes = read;
      })
      .catch((error: unknown) => notices.refusal(error));
    return () => {
      listening = false;
    };
  });
</script>

<div class="grid max-w-3xl gap-4">
  <Failed {projectId} />
  {#each catalog.subscriptions as provider (provider)}
    <ProviderGroup {provider} lifetime={lifetimes.find((row) => row.provider === provider)} />
  {/each}
  {#each catalog.keyed as provider (provider)}
    <ConsoleKeyGroup {provider} />
  {/each}
  {#each catalog.settings as settings (settings.adapter)}
    <InstanceSection {settings} />
  {/each}
  {#each uninstalled as group (group.provider)}
    <section class="@container overflow-hidden rounded-lg border bg-raised" aria-label={group.provider}>
      <div class="flex min-h-9 items-center gap-2 px-3 py-1">
        <h3 class="text-ui font-semibold">{group.provider}</h3>
        <span class="text-ui text-muted-foreground">provider not installed</span>
      </div>
      {#each group.rows as row (row.account)}
        <AccountRow {row} />
      {/each}
    </section>
  {/each}
  {#each accounts.consoleKeys.data ?? [] as entry (entry.provider)}
    <SpeechKeyGroup {entry} />
  {/each}
  {#if accounts.consoleKeys.error != null}
    <section class="flex items-center gap-3 rounded-lg border border-destructive/40 bg-raised px-3 py-3" role="alert">
      <p class="flex-1 text-ui text-destructive">The speech provider keys could not be read: {accounts.consoleKeys.error.message}</p>
      <Button variant="outline" size="sm" onclick={() => void accounts.consoleKeys.refresh()}>Retry</Button>
    </section>
  {/if}
</div>
