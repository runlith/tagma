<script lang="ts">
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Settings from '@lucide/svelte/icons/settings';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { Snippet } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
  import ProviderMenu from '../Menu.svelte';
  import UsageRow from './Row.svelte';
  import { UsageAccounts, type UsageProvider } from './Accounts.svelte.js';
  import { CountdownClock } from '../accounts/CountdownClock.svelte.js';
  import { NEED_WORDS, usageAbsence, usageNeed, usageStatus } from '../accounts/status.js';
  import { MENU_ROW } from './usageMenu.js';
  import { tightestFigure, usageFigures } from './windows.js';

  let {
    thread,
    useInThread = null,
    followDefault = null,
    children,
  }: {
    thread: { provider: string; account: string | null; pinned: boolean } | null;
    useInThread?: ((account: string) => Promise<void>) | null;
    followDefault?: (() => Promise<void>) | null;
    children?: Snippet;
  } = $props();

  const notices = Notices.use();
  const usageAccounts = UsageAccounts.use();
  const countdownClock = CountdownClock.use();
  const accounts = AccountsRepo.use();
  const router = Router.use();

  const REFRESH_WORDS = 'Read every account now';

  let open = $state(false);

  const now = $derived(countdownClock.now);
  const roster = $derived([...usageAccounts.providers].sort((left, right) => worstOf(right) - worstOf(left)));

  function worstOf(entry: UsageProvider): number {
    return tightestFigure(usageFigures(entry.standing.quota))?.usedPercent ?? 0;
  }

  function statusOf(entry: UsageProvider): string | null {
    const row = entry.standing;
    if (usageFigures(row.quota).length > 0) return null;
    const need = usageNeed(row, entry.served);
    if (need !== null) return need === 'new-key' ? 'key refused' : 'signed out';
    switch (usageAbsence(row, entry.served)) {
      case 'reading':
        return 'Loading usage…';
      case 'unmeasured':
        return 'No usage reported';
      case 'unread':
        return usageStatus(row, entry.served, now).word;
    }
  }

  let asking = $state(false);
  async function refresh(): Promise<void> {
    asking = true;
    try {
      await accounts.refresh.run({}, { throwOnError: true });
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      asking = false;
    }
  }

  function manage(): void {
    void router.goto(settingsHref(router));
  }

  $effect(() => {
    if (!open) return;
    return countdownClock.watch();
  });
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger
    class="rounded-md px-1.5 py-0.5 transition-colors hover:bg-hover data-[state=open]:bg-selected"
    aria-label="Subscriptions and usage"
  >
    {@render children?.()}
  </DropdownMenu.Trigger>

  <DropdownMenu.Content
    side="top"
    align="end"
    sideOffset={8}
    collisionPadding={{ top: 8, bottom: 32, left: 8, right: 8 }}
    class="max-h-[75vh] w-90"
  >
    <div class="flex items-center justify-between py-1 pr-1 pl-2">
      <span class="text-ui font-semibold text-foreground">Usage</span>
      <Tooltip text={REFRESH_WORDS}>
        <DropdownMenu.Item
          unstyled
          class="grid size-6 cursor-default place-items-center rounded-md text-muted-foreground outline-hidden select-none data-disabled:pointer-events-none data-highlighted:bg-selected data-highlighted:text-foreground"
          closeOnSelect={false}
          disabled={asking}
          aria-label={REFRESH_WORDS}
          textValue={REFRESH_WORDS}
          onSelect={() => void refresh()}
          data-usage-refresh
        >
          {#if asking}<Waiting class="size-3.5" />{:else}<RefreshCw class="size-3.5" />{/if}
        </DropdownMenu.Item>
      </Tooltip>
    </div>

    {#each roster as entry (entry.provider)}
      {@const need = usageNeed(entry.standing, entry.served)}
      {#if need !== null && usageFigures(entry.standing.quota).length === 0}
        <DropdownMenu.Item unstyled class={MENU_ROW} onSelect={manage} data-roster-row={entry.provider}>
          <UsageRow {entry} {now} status={statusOf(entry)} action={NEED_WORDS[need]} />
        </DropdownMenu.Item>
      {:else}
        <ProviderMenu {entry} {now} status={statusOf(entry)} {thread} {useInThread} {followDefault} onSignIn={manage} onManage={manage} />
      {/if}
    {/each}

    <DropdownMenu.Separator />
    <DropdownMenu.Item icon={Settings} onSelect={manage}>Manage accounts…</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
