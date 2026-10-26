<script lang="ts">
  import Gauge from '@lucide/svelte/icons/gauge';
  import { ThreadOnScreen } from '$lib/features/threads/OnScreen.svelte.js';
  import { UsageAccounts, type UsageProvider } from '$lib/features/providers/usage/Accounts.svelte.js';
  import { CountdownClock } from '$lib/features/providers/accounts/CountdownClock.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { figureReading } from '$lib/features/providers/usage/thresholds.js';
  import { percentInk } from '$lib/features/providers/accounts/tone.js';
  import UsageGauge from '$lib/features/providers/usage/Gauge.svelte';
  import UsagePopover from '$lib/features/providers/usage/Popover.svelte';
  import { NEED_WORDS, reportsUsage, usageAbsence, usageNeed, usageStatus } from '$lib/features/providers/accounts/status.js';
  import { approxText, resetText, tightestFigure, usageFigures, usagePercentText } from '$lib/features/providers/usage/windows.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  const threadOnScreen = ThreadOnScreen.use();
  const usageAccounts = UsageAccounts.use();
  const catalog = ProviderCatalog.use();
  const countdownClock = CountdownClock.use();

  const host = $derived(threadOnScreen.host);
  const chosen = $derived(host?.views.model.settings ?? null);

  $effect(() => countdownClock.watch());

  const thread = $derived(host?.activeThread ?? null);
  const threadAccount = $derived(
    thread === null ? null : { provider: thread.provider, account: chosen?.account || null, pinned: thread.account !== null },
  );

  const measured = $derived(usageAccounts.providers.filter((entry) => reportsUsage(entry.standing, entry.served)));

  function hint(entry: UsageProvider, now: number): string {
    const row = entry.standing;
    const status = usageStatus(row, entry.served, now);
    const tightest = tightestFigure(usageFigures(row.quota));
    const need = usageNeed(row, entry.served);
    const parts: (string | null)[] = [catalog.name(entry.provider)];
    if (tightest !== null) {
      const { emptyAt } = figureReading(tightest, now);
      parts.push(
        [usagePercentText(tightest.usedPercent), tightest.name].filter((part) => part !== null).join(' '),
        emptyAt === null ? null : `empty in ${approxText(emptyAt - now)}`,
        tightest.resetsAt === null ? null : `resets in ${resetText(tightest.resetsAt, now)}`,
      );
    } else if (need === null && usageAbsence(row, entry.served) === 'reading') {
      parts.push('reading usage');
    } else {
      parts.push(status.word);
    }
    if (need !== null && tightest !== null) parts.push(NEED_WORDS[need]);
    parts.push(status.note);
    return parts.filter((part) => part !== null).join(' · ');
  }
</script>

{#if usageAccounts.providers.length > 0}
  <UsagePopover
    thread={threadAccount}
    useInThread={host && thread ? (account) => host.writes.applyAccount(account) : null}
    followDefault={host && thread ? () => host.writes.applyAccount(null) : null}
  >
    <span class="flex items-center gap-2" data-usage-meters>
      {#each measured as entry (entry.provider)}
        {@const tightest = tightestFigure(usageFigures(entry.standing.quota))}
        {@const need = usageNeed(entry.standing, entry.served)}
        {@const stale = usageStatus(entry.standing, entry.served, countdownClock.now).stale}
        <Tooltip text={hint(entry, countdownClock.now)}>
          <span class="flex shrink-0 items-center gap-1" data-usage-segment={entry.provider}>
            <UsageGauge provider={entry.provider} row={entry.standing} />
            {#if tightest !== null}
              {@const tone = figureReading(tightest, countdownClock.now).tone}
              <span class="whitespace-nowrap tabular-nums transition-opacity {percentInk(tone)} {stale ? 'opacity-45' : ''}">
                {usagePercentText(tightest.usedPercent)}
              </span>
            {:else if need !== null}
              <span class="whitespace-nowrap text-severity-gap">{NEED_WORDS[need].toLowerCase()}</span>
            {/if}
          </span>
        </Tooltip>
      {:else}
        <Gauge class="size-3.5" aria-hidden="true" />
      {/each}
    </span>
  </UsagePopover>
{/if}
