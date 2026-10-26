<script lang="ts">
  import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
  import { ProviderCatalog } from '../Catalog.svelte.js';

  import { Button } from '$lib/shared/ui/button/index.js';
  import { Input } from '$lib/shared/ui/input/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import ProviderMark from '$lib/features/providers/Mark.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
  import { CountdownClock } from '../accounts/CountdownClock.svelte.js';
  import { UsageAccounts } from '../usage/Accounts.svelte.js';
  import { usageStatus } from '../accounts/status.js';
  import { figureTone } from '../usage/thresholds.js';
  import { toneFill, toneText } from '../accounts/tone.js';
  import Bar from '$lib/shared/ui/Bar.svelte';
  import { figureText, usageFigures, type UsageFigure } from '../usage/windows.js';
  import CatalogState from '../models/CatalogState.svelte';
  import RefreshModels from '../models/RefreshModels.svelte';

  const notices = Notices.use();
  const accounts = AccountsRepo.use();
  const countdownClock = CountdownClock.use();
  const usageAccounts = UsageAccounts.use();
  const catalog = ProviderCatalog.use();

  let { provider }: { provider: string } = $props();

  const served = $derived(catalog.provider(provider));
  const name = $derived(`${catalog.label(provider)} API key`);
  const single = $derived(served?.keyScope === 'identity');
  const hint = $derived(served?.keyHint ?? null);

  const rows = $derived(usageAccounts.of(provider));
  let key = $state('');
  let busy = $state<string | null>(null);

  $effect(() => countdownClock.watch());

  async function act(work: () => Promise<unknown>, mark: string): Promise<void> {
    busy = mark;
    try {
      await work();
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      busy = null;
    }
  }

  async function save(): Promise<void> {
    const pasted = key.trim();
    if (pasted === '') return;
    const replaces = single ? rows[0]?.account : undefined;
    await act(async () => {
      await accounts.saveConsoleKey.run(
        { provider, key: pasted, replaces: replaces === undefined ? undefined : String(replaces) },
        { throwOnError: true },
      );
      key = '';
    }, 'save');
  }

  function useByDefault(row: AccountQuotaRow): void {
    if (row.default) return;
    void act(() => accounts.useByDefault.run({ provider, account: row.account }, { throwOnError: true }), String(row.account));
  }

  const figuresOf = (row: AccountQuotaRow): readonly UsageFigure[] => usageFigures(row.quota);
</script>

<section class="@container overflow-hidden rounded-lg border bg-raised" aria-label={name}>
  <div class="flex min-h-9 items-center gap-2 px-3 py-1">
    <ProviderMark {provider} class="size-4 text-foreground" />
    <h3 class="text-ui font-semibold">{name}</h3>
    {#if usageAccounts.known}
      {#if rows.length > 0}
        <Tooltip text={rows.length === 1 ? 'Key set' : `${rows.length} keys`}>
          <span class="size-2 shrink-0 rounded-full bg-status-done"></span>
        </Tooltip>
        <span class="text-ui text-muted-foreground">
          {rows.length === 1 ? 'key set' : `${rows.length} keys`}
        </span>
      {:else}
        <Tooltip text="No key">
          <span class="size-2 shrink-0 rounded-full border-[1.5px] border-vein-strong"></span>
        </Tooltip>
        <span class="text-ui text-muted-foreground">not set</span>
      {/if}
    {/if}
    {#if served?.dynamicCatalog && rows.length > 0}
      <span class="flex-1"></span>
      <RefreshModels {provider} />
    {/if}
  </div>

  <CatalogState {served} />

  {#if rows.length > 0}
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <div role="radiogroup" aria-label="{name} default account" tabindex={-1}>
      {#each rows as row (row.account)}
        {@const status = usageStatus(row, served, countdownClock.now)}
        <div class="flex items-center gap-3 border-t border-border px-3 py-2" data-console-key={row.account}>
          <Tooltip text={row.default ? 'Threads that pinned no key sign with this one' : 'Use for every thread that pinned no key'}>
            <button
              type="button"
              role="radio"
              aria-checked={row.default}
              tabindex={row.default ? 0 : -1}
              aria-label="Use {row.label} by default"
              class="grid size-3.5 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors {row.default
                ? 'border-foreground'
                : 'border-vein-strong hover:border-foreground'}"
              disabled={busy !== null}
              onclick={() => useByDefault(row)}
            >
              {#if row.default}
                <span class="size-2 rounded-full bg-foreground"></span>
              {/if}
            </button>
          </Tooltip>
          <span class="font-mono text-ui {row.default ? 'text-foreground' : 'text-muted-foreground'}">
            {row.label}
          </span>
          <div class="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
            {#each figuresOf(row) as figure (figure.kind + (figure.name ?? ''))}
              <Tooltip text={figureText(figure, countdownClock.now)}>
                <span class="flex items-center gap-1.5">
                  <span class="text-meta text-muted-foreground">{figure.name ?? figure.kind}</span>
                  <Bar used={figure.usedPercent} color={toneFill(figureTone(figure, countdownClock.now))} class="h-1.25 w-16" />
                  <span class="text-small tabular-nums text-muted-foreground">{Math.round(figure.usedPercent)}%</span>
                </span>
              </Tooltip>
            {:else}
              <span class="text-small {toneText(status.tone)}">{status.word ?? 'usage unread'}</span>
            {/each}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onclick={() =>
              void act(
                () => accounts.removeConsoleKey.run({ provider, account: String(row.account) }, { throwOnError: true }),
                String(row.account),
              )}
          >
            Remove
          </Button>
        </div>
      {/each}
    </div>
  {/if}

  {#if usageAccounts.known}
    <div class="grid gap-2 border-t border-border bg-sunken px-3 py-3">
      {#if hint !== null}
        <p class="text-ui text-muted-foreground">{hint}</p>
      {/if}
      <div class="flex items-center gap-2">
        <Input type="password" class="font-mono" placeholder="Paste key…" bind:value={key} disabled={busy !== null} />
        <Button variant="default" size="sm" disabled={busy !== null || key.trim() === ''} onclick={() => void save()}>
          {rows.length === 0 ? 'Save' : single ? 'Replace' : 'Add'}
        </Button>
      </div>
    </div>
  {/if}
</section>
