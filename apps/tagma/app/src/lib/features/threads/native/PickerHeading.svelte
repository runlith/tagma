<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { signsIn } from '$lib/features/providers/served.js';
  import UsageGauge from '$lib/features/providers/usage/Gauge.svelte';
  import { signerOf, UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import QuotaHeading from '$lib/features/providers/usage/QuotaHeading.svelte';
  import { tightestFigure, usageFigures, usagePercentText } from '$lib/features/providers/usage/windows.js';
  import FadeText from '$lib/shared/FadeText.svelte';

  let {
    provider,
    label,
    now,
    shown,
    here,
    pinned,
    open,
    busy,
    ontoggle,
    onchoose,
  }: {
    provider: string;
    label: string;
    now: number;
    shown: string | null;
    here: boolean;
    pinned: boolean;
    open: boolean;
    busy: boolean;
    ontoggle: () => void;
    onchoose: (account: string | null) => void;
  } = $props();

  const catalog = ProviderCatalog.use();
  const accounts = UsageAccounts.use();

  const rows = $derived(signsIn(catalog.models, provider) ? accounts.signing(provider) : []);
  const signer = $derived(signerOf(rows));
  const account = $derived(shown ?? (signer === null ? null : String(signer.account)));
  const shownRow = $derived(rows.find((row) => String(row.account) === account));
  const missing = $derived(account !== null && shownRow === undefined);
  const named = $derived(shownRow?.label ?? account);
  const pushed = $derived(shownRow === undefined || tightestFigure(usageFigures(shownRow.quota)) === null);
  const choosable = $derived(rows.length > 1 || (here && pinned) || (missing && rows.length > 0));
  const active = $derived(rows.find((row) => row.default) ?? null);
  const explicit = $derived(here ? pinned : shown !== null);
  const mode = $derived(account === null ? null : explicit ? 'Pinned' : 'Follows default');

  const ITEM =
    'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-small transition-colors hover:bg-hover disabled:opacity-60';
</script>

{#snippet modeWord()}
  {#if mode !== null}
    <span class="text-muted-foreground/70" data-picker-mode={explicit ? 'pinned' : 'default'}>{mode}</span>
  {/if}
{/snippet}

<div class="eyebrow flex min-w-0 items-center gap-1.5 px-2 pt-2 pb-1 text-muted-foreground" data-picker-heading={provider}>
  <QuotaHeading {provider} {label} {now} {account} />
  {#if choosable}
    <button
      type="button"
      tabindex="-1"
      class={[
        'flex h-5 min-w-0 max-w-56 shrink items-center gap-1 rounded-md px-1.5 font-normal transition-colors hover:bg-hover hover:text-foreground',
        open ? 'bg-hover text-foreground' : missing ? 'text-severity-lie' : named === null ? 'text-muted-foreground' : 'text-foreground/80',
        pushed && 'ml-auto',
      ]}
      aria-expanded={open}
      aria-label="Account"
      data-picker-account={account}
      onclick={ontoggle}
    >
      <span data-line class="items-center gap-1">
        <FadeText text={named ?? 'Choose an account'} />
        {@render modeWord()}
      </span>
      <ChevronDown class="size-3 shrink-0" />
    </button>
  {:else if named !== null}
    <span data-line class={['max-w-56 shrink items-center gap-1 px-1.5 font-normal text-muted-foreground', pushed && 'ml-auto']}>
      <FadeText text={named} />
      {@render modeWord()}
    </span>
  {/if}
</div>

{#if open}
  <div class="grid gap-px px-1 pb-1" data-picker-accounts={provider}>
    {#each rows as row (row.account)}
      {@const id = String(row.account)}
      {@const figure = tightestFigure(usageFigures(row.quota))}
      <button type="button" tabindex="-1" class={[ITEM, id === account && 'bg-selected']} disabled={busy} onclick={() => onchoose(id)}>
        {#if here && id === account}
          <span class="size-1.5 shrink-0 bg-brand" aria-label="This thread signs with it"></span>
        {:else}
          <span class="w-1.5 shrink-0"></span>
        {/if}
        <FadeText class="flex-1 text-foreground/90" text={row.label} />
        <UsageGauge {provider} {row} marked={false} />
        <span class="stamp w-8 text-right text-muted-foreground">{figure === null ? '' : usagePercentText(figure.usedPercent)}</span>
      </button>
    {/each}
    {#if here && pinned && active !== null}
      <button type="button" tabindex="-1" class={[ITEM, 'text-muted-foreground']} disabled={busy} onclick={() => onchoose(null)}>
        <span class="w-1.5 shrink-0"></span>
        <span class="shrink-0">Follow the default</span>
        <FadeText class="flex-1 text-muted-foreground/70" text={active.label} />
      </button>
    {/if}
  </div>
{/if}
