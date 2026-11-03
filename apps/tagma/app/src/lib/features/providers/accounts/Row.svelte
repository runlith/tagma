<script lang="ts">
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
  import { Dialogs } from '@runlith/primitives/DialogRegistry.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { spellKey } from '$lib/shared/chordSpelling.js';
  import { Host } from '@runlith/layer/Host';
  import FadeText from '$lib/shared/FadeText.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import { CountdownClock } from './CountdownClock.svelte.js';
  import RemoveAccountDialog from '../auth/RemoveAccountDialog.svelte';
  import { usageNeed, usageStatus, readingAt, updatedAgo, NEED_WORDS } from './status.js';
  import { figureTone } from '../usage/thresholds.js';
  import { toneFill, toneText } from './tone.js';
  import Bar from '$lib/shared/ui/Bar.svelte';
  import { barFigures, resetText, usageFigures, usagePercentText } from '../usage/windows.js';

  let { row, onSignIn }: { row: AccountQuotaRow; onSignIn?: () => void } = $props();

  const dialogs = Dialogs.use();
  const notices = Notices.use();
  const apple = Host.use().apple;
  const countdownClock = CountdownClock.use();
  const accounts = AccountsRepo.use();
  const catalog = ProviderCatalog.use();

  const TAG = 'shrink-0 rounded-sm border px-1 stamp leading-4';
  const MENU_TRIGGER =
    'grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground';

  const uninstalled = $derived(row.problem?.kind === 'not-installed');
  const served = $derived(catalog.provider(row.provider));
  const status = $derived(usageStatus(row, served, countdownClock.now));
  const figures = $derived(usageFigures(row.quota));
  const bars = $derived(barFigures(figures));
  const signInNeed = $derived(usageNeed(row, served, countdownClock.now));
  const needsSignIn = $derived(signInNeed !== null);
  const keyed = $derived(row.label === String(row.account));
  const section = $derived(catalog.section(row.provider));
  const mode = $derived(section?.options.find((option) => option.provider === row.provider));
  const directory = $derived(row.origin.kind === 'cli' && row.origin.place !== 'default' ? row.origin.place : null);
  const place = $derived(
    row.origin.kind === 'own' ? 'Tagma sign-in' : (mode?.defaultPlace ?? `${mode?.label ?? catalog.name(row.provider)} default`),
  );
  const staleNote = $derived(status.stale && status.note !== null && bars.length > 0 ? status.note : null);
  const read = $derived(readingAt(row));

  let busy = $state(false);
  let renaming = $state<string | null>(null);

  $effect(() => countdownClock.watch());

  async function act(work: () => Promise<unknown>): Promise<void> {
    busy = true;
    try {
      await work();
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      busy = false;
    }
  }

  function commitRename(): void {
    const written = renaming?.trim() ?? '';
    const unchanged = written.length === 0 || written === row.label;
    renaming = null;
    if (unchanged) return;
    void act(() => accounts.relabel.run({ provider: row.provider, account: row.account, label: written }, { throwOnError: true }));
  }

  function confirmRemove(): void {
    const handle = dialogs.open(RemoveAccountDialog, {
      provider: row.provider,
      label: row.label,
      isDefault: row.default,
      onCancel: () => handle.close(),
      onConfirm: () => {
        handle.close();
        void act(() => accounts.remove.run({ provider: row.provider, account: row.account }, { throwOnError: true }));
      },
    });
  }

  function useByDefault(): void {
    if (row.default) return;
    void act(() => accounts.useByDefault.run({ provider: row.provider, account: row.account }, { throwOnError: true }));
  }
</script>

{#snippet renameField(classes: string)}
  <!-- svelte-ignore a11y_autofocus -->
  <input
    class="min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 py-0.5 outline-none focus:border-ring {classes}"
    autofocus
    bind:value={renaming}
    onblur={commitRename}
    onkeydown={(event) => {
      if (event.key === 'Enter') commitRename();
      if (event.key === 'Escape') renaming = null;
    }}
    aria-label="Account label"
  />
{/snippet}

{#if uninstalled}
  <div class="flex items-center gap-3 border-t border-border px-3 py-2 text-ui" data-account-row>
    <FadeText class="min-w-0 flex-1 font-medium">{row.label}</FadeText>
    <button
      type="button"
      class="rounded-md px-1.5 py-1 text-small text-destructive transition-colors hover:bg-hover-danger"
      disabled={busy}
      onclick={() => void act(() => accounts.remove.run({ provider: row.provider, account: row.account }, { throwOnError: true }))}
      >Remove</button
    >
  </div>
{:else}
  <div
    class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-3 py-2 text-ui @min-[34rem]:grid-cols-[auto_minmax(0,1fr)_13.5rem_auto]"
    data-account-row
  >
    <Tooltip text={row.default ? 'Threads that pinned no account sign with this one' : 'Use for every thread that pinned no account'}>
      <button
        type="button"
        role="radio"
        aria-checked={row.default}
        tabindex={row.default ? 0 : -1}
        aria-label="Use {row.label} by default"
        class="grid size-3.5 place-items-center rounded-full border-[1.5px] transition-colors {row.default
          ? 'border-foreground'
          : 'border-vein-strong hover:border-foreground'}"
        disabled={busy}
        onclick={useByDefault}
      >
        {#if row.default}
          <span class="size-1.5 rounded-full bg-foreground"></span>
        {/if}
      </button>
    </Tooltip>

    <div class="grid min-w-0 gap-0.5">
      {#if renaming === null}
        <div class="flex min-w-0 items-center gap-2">
          <Tooltip text={row.label} class="block min-w-0">
            <FadeText class={cn('block min-w-0', keyed ? 'stamp text-ui' : 'font-medium')}>{row.label}</FadeText>
          </Tooltip>
          {#if directory !== null}
            <PathText path={directory} class="min-w-0 text-small text-muted-foreground" />
          {:else}
            <FadeText class="min-w-0 shrink text-small text-muted-foreground">{place}</FadeText>
          {/if}
          {#if row.problem !== null}
            <Tooltip text={status.note ?? undefined}>
              <span
                class="{TAG} {status.tone === 'alarm'
                  ? 'border-destructive/40 text-destructive'
                  : 'border-severity-gap/40 text-severity-gap'}"
              >
                {status.word}
              </span>
            </Tooltip>
          {/if}
        </div>
        {#if row.expiresAt !== undefined || staleNote !== null}
          <div class="flex min-w-0 items-center gap-3 text-small text-muted-foreground">
            {#if row.expiresAt !== undefined}
              <span class="shrink-0">Expires {new Date(row.expiresAt).toLocaleDateString()}</span>
            {/if}
            {#if staleNote !== null}
              <FadeText class="min-w-0">{staleNote}</FadeText>
            {/if}
          </div>
        {/if}
      {:else}
        {@render renameField('text-ui')}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground">
          <span class="flex items-center gap-1.5"><Kbd chord={spellKey('Enter', apple)} size="sm" />saves</span>
          <span class="flex items-center gap-1.5"><Kbd chord={spellKey('Escape', apple)} size="sm" />keeps the stored name</span>
        </div>
      {/if}
    </div>

    <div
      class="hidden items-center gap-x-2 gap-y-1 transition-opacity @min-[34rem]:grid @min-[34rem]:grid-cols-[1.5rem_4rem_2.5rem_auto] {status.stale &&
      bars.length > 0
        ? 'opacity-45'
        : ''}"
    >
      {#if bars.length > 0}
        {#each bars as figure (figure.kind + (figure.name ?? ''))}
          {@const tone = figureTone(figure, countdownClock.now)}
          <span class="stamp text-muted-foreground">{figure.name ?? ''}</span>
          <Bar used={figure.usedPercent} color={toneFill(tone)} class="h-1" />
          <span class="text-right stamp {toneText(tone)}">{usagePercentText(figure.usedPercent)}</span>
          <span class="whitespace-nowrap stamp text-muted-foreground">
            {figure.resetsAt === null ? '' : resetText(figure.resetsAt, countdownClock.now)}
          </span>
        {/each}
      {:else if status.word !== null}
        <Tooltip text={status.note ?? undefined} class="col-span-4 block min-w-0">
          <span class="stamp {toneText(status.tone)}">{status.word}</span>
        </Tooltip>
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-1">
      {#if needsSignIn && onSignIn !== undefined}
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-small font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          disabled={busy}
          aria-label="Sign in as {row.label}"
          onclick={onSignIn}>{signInNeed === null ? 'Sign in' : NEED_WORDS[signInNeed]}</button
        >
      {/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class={MENU_TRIGGER} aria-label="Account actions" disabled={busy}>
          <Ellipsis class="size-3.5" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-40">
          <DropdownMenu.Item
            icon={RefreshCw}
            onSelect={() => void act(() => accounts.refresh.run({ provider: row.provider, account: row.account }, { throwOnError: true }))}
          >
            Refresh quota
          </DropdownMenu.Item>
          <DropdownMenu.Item icon={PencilLine} onSelect={() => (renaming = row.label)}>Rename</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item variant="destructive" icon={Trash2} onSelect={confirmRemove}>Remove</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Note text={read === null ? 'Usage not yet updated' : `Usage updated ${updatedAgo(read, countdownClock.now)}`} />
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>
{/if}
