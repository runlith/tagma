<script lang="ts">
  import { figureTone, figureWhen } from './thresholds.js';
  import { toneText } from '../accounts/tone.js';
  import { UsageAccounts } from './Accounts.svelte.js';
  import UsageGauge from './Gauge.svelte';
  import { tightestFigure, usageFigures, usagePercentText } from './windows.js';

  let { provider, label, now, account }: { provider: string; label: string; now: number; account?: string | null } = $props();

  const usageAccounts = UsageAccounts.use();
  const quota = $derived.by(() => {
    const row =
      account === undefined
        ? usageAccounts.providers.find((entry) => entry.provider === provider)?.standing
        : usageAccounts.signing(provider).find((one) => String(one.account) === account);
    if (row === undefined) return null;
    return { row, figure: tightestFigure(usageFigures(row.quota)) };
  });
  const when = $derived(quota?.figure ? figureWhen(quota.figure, now) : null);
</script>

<UsageGauge {provider} row={quota?.row} />
{label}
{#if quota?.figure}
  <span class="stamp ml-auto normal-case {toneText(figureTone(quota.figure, now))}" data-tone>
    {usagePercentText(quota.figure.usedPercent)}{quota.figure.name === null ? '' : ` ${quota.figure.name}`}
  </span>
  {#if when !== null}<span class="font-normal text-muted-foreground/75">{when}</span>{/if}
{/if}
