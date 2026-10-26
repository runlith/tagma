<script lang="ts">
  import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import TileMeter from '$lib/shared/ui/TileMeter.svelte';
  import { CountdownClock } from '../accounts/CountdownClock.svelte.js';
  import { ProviderCatalog } from '../Catalog.svelte.js';
  import { usageNeed, usageStatus } from '../accounts/status.js';
  import { figureTone } from './thresholds.js';
  import { toneFill } from '../accounts/tone.js';
  import { tightestFigure, usageFigures } from './windows.js';

  let { provider, row, marked = true }: { provider: string; row: AccountQuotaRow | undefined; marked?: boolean } = $props();

  const TILES = 5;

  const countdownClock = CountdownClock.use();
  const catalog = ProviderCatalog.use();
  $effect(() => countdownClock.watch());

  const tightest = $derived(row === undefined ? null : tightestFigure(usageFigures(row.quota)));
  const fill = $derived(tightest === null ? 0 : Math.max(0, Math.min(100, tightest.usedPercent)));
  const lit = $derived(Math.round((fill / 100) * TILES));
  const tone = $derived(tightest === null ? 'plain' : figureTone(tightest, countdownClock.now));
  const served = $derived(catalog.provider(provider));
  const stale = $derived(row !== undefined && usageStatus(row, served, countdownClock.now).stale);
  const needed = $derived(row !== undefined && tightest === null && usageNeed(row, served) !== null);
</script>

<span
  class="flex shrink-0 items-center gap-1 transition-opacity {stale && !needed ? 'opacity-45' : ''}"
  data-gauge
  data-fill={fill}
  data-tone={tone}
  data-stale={stale ? '' : undefined}
>
  {#if marked}
    <ProviderMark {provider} titled={false} class="size-3 {row === undefined ? 'text-muted-foreground' : 'text-foreground'}" />
  {/if}
  <TileMeter count={TILES} {lit} fill={toneFill(tone)} track={row === undefined ? 'none' : needed ? 'outlined' : 'filled'} />
</span>
