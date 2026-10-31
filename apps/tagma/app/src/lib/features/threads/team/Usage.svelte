<script lang="ts">
  import { CountdownClock } from '$lib/features/providers/accounts/CountdownClock.svelte.js';
  import { toneText } from '$lib/features/providers/accounts/tone.js';
  import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import Gauge from '$lib/features/providers/usage/Gauge.svelte';
  import { figureTone } from '$lib/features/providers/usage/thresholds.js';
  import { tightestFigure, usageFigures, usagePercentText } from '$lib/features/providers/usage/windows.js';

  let { provider, part, marked = true }: { provider: string; part: 'gauge' | 'percent'; marked?: boolean } = $props();

  const accounts = UsageAccounts.use();
  const clock = CountdownClock.use();
  $effect(() => clock.watch());

  const standing = $derived(accounts.signing(provider)[0]);
  const tightest = $derived(standing === undefined ? null : tightestFigure(usageFigures(standing.quota)));
</script>

{#if part === 'gauge'}
  <Gauge {provider} row={standing} {marked} />
{:else if tightest !== null}
  <span class="shrink-0 font-mono text-meta tabular-nums {toneText(figureTone(tightest, clock.now))}" data-team-usage={provider} data-tone>
    {usagePercentText(tightest.usedPercent)}
  </span>
{/if}
