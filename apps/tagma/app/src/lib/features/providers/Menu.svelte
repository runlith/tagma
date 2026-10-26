<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import LogIn from '@lucide/svelte/icons/log-in';
  import Pin from '@lucide/svelte/icons/pin';
  import Settings from '@lucide/svelte/icons/settings';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
  import ProviderMark from './Mark.svelte';
  import ProviderPanel from './Panel.svelte';
  import UsageRow from './usage/Row.svelte';
  import type { UsageProvider } from './usage/Accounts.svelte.js';
  import { ProviderCatalog } from './Catalog.svelte.js';
  import { NEED_WORDS, usageNeed } from './accounts/status.js';
  import { toneText } from './accounts/tone.js';
  import { figureTone } from './usage/thresholds.js';
  import { MENU_ROW } from './usage/usageMenu.js';
  import { tightestFigure, usageFigures, usagePercentText } from './usage/windows.js';

  let {
    entry,
    now,
    status,
    thread,
    useInThread,
    followDefault,
    onSignIn,
    onManage,
  }: {
    entry: UsageProvider;
    now: number;
    status: string | null;
    thread: { provider: string; account: string | null; pinned: boolean } | null;
    useInThread: ((account: string) => Promise<void>) | null;
    followDefault: (() => Promise<void>) | null;
    onSignIn: (row: AccountQuotaRow) => void;
    onManage: () => void;
  } = $props();

  const notices = Notices.use();
  const accounts = AccountsRepo.use();
  const catalog = ProviderCatalog.use();

  const name = $derived(catalog.name(entry.provider));
  const defaultRow = $derived(entry.rows.find((row) => row.default) ?? entry.standing);
  const need = $derived(usageNeed(entry.standing, entry.served));
  const ofThisThread = $derived(thread !== null && thread.provider === entry.provider);
  const pinnedRow = $derived(
    ofThisThread && thread !== null ? entry.rows.find((row) => String(row.account) === thread.account) : undefined,
  );
  const pinnable = $derived(entry.rows.filter((row) => pinOffered(row)));
  const wayBack = $derived(ofThisThread && thread !== null && thread.pinned && followDefault !== null);

  let busy = $state(false);

  async function act(work: () => Promise<unknown>): Promise<boolean> {
    busy = true;
    try {
      await work();
      return true;
    } catch (error: unknown) {
      notices.refusal(error);
      return false;
    } finally {
      busy = false;
    }
  }

  function makeDefault(account: string): void {
    const row = entry.rows.find((one) => String(one.account) === account);
    if (row === undefined || row.default) return;
    void act(() => accounts.useByDefault.run({ provider: row.provider, account: row.account }, { throwOnError: true }));
  }

  function pin(row: AccountQuotaRow): void {
    if (useInThread === null) return;
    const point = useInThread;
    void act(() => point(String(row.account)));
  }

  function follow(): void {
    if (followDefault === null) return;
    void act(followDefault);
  }

  function isThread(row: AccountQuotaRow): boolean {
    return ofThisThread && thread !== null && String(row.account) === (thread.account ?? '');
  }

  function pinOffered(row: AccountQuotaRow): boolean {
    return ofThisThread && useInThread !== null && !isThread(row);
  }

  function labelOf(row: AccountQuotaRow): string {
    return row.label === String(row.account) ? row.label.slice(0, 8) : row.label;
  }
</script>

<DropdownMenu.Sub>
  <DropdownMenu.SubTrigger unstyled class={MENU_ROW} data-roster-row={entry.provider}>
    <UsageRow {entry} {now} {status} />
    <ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
  </DropdownMenu.SubTrigger>
  <DropdownMenu.SubContent
    collisionPadding={{ top: 8, bottom: 32, left: 8, right: 8 }}
    class="max-h-(--float-available-height) w-75 overflow-y-auto"
    data-provider-detail={entry.provider}
  >
    <div class="p-2">
      <ProviderPanel {entry} {now} />
    </div>

    <DropdownMenu.Separator />
    <DropdownMenu.Label>{name} account</DropdownMenu.Label>
    <DropdownMenu.RadioGroup value={String(defaultRow.account)} onValueChange={makeDefault}>
      {#each entry.rows as row (row.account)}
        {@const rowNeed = usageNeed(row, entry.served)}
        {@const tightest = tightestFigure(usageFigures(row.quota))}
        <DropdownMenu.RadioItem value={String(row.account)} disabled={busy} closeOnSelect={false} data-switch-row={row.account}>
          {#snippet lead()}<ProviderMark provider={row.provider} titled={false} class="size-3.5" />{/snippet}
          {labelOf(row)}{#if rowNeed !== null}<span class="ml-1.5 text-severity-gap">{NEED_WORDS[rowNeed]}</span
            >{:else if tightest !== null}<span class="ml-1.5 tabular-nums {toneText(figureTone(tightest, now))}"
              >{usagePercentText(tightest.usedPercent)}</span
            >{/if}
        </DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
    {#if need !== null}
      <DropdownMenu.Item icon={LogIn} onSelect={() => onSignIn(entry.standing)}>{NEED_WORDS[need]}</DropdownMenu.Item>
    {/if}

    {#if wayBack || pinnable.length > 0}
      <DropdownMenu.Separator />
      <DropdownMenu.Label>This thread</DropdownMenu.Label>
      {#if wayBack && thread !== null}
        <DropdownMenu.Item
          icon={Undo2}
          current={pinnedRow === undefined ? (thread.account ?? 'an account') : labelOf(pinnedRow)}
          disabled={busy}
          onSelect={follow}
          data-thread-strip
        >
          Follow the default
        </DropdownMenu.Item>
      {/if}
      {#each pinnable as row (row.account)}
        <DropdownMenu.Item icon={Pin} current={labelOf(row)} disabled={busy} onSelect={() => pin(row)} data-pin-row={row.account}>
          Use in this thread
        </DropdownMenu.Item>
      {/each}
    {/if}

    <DropdownMenu.Separator />
    <DropdownMenu.Item icon={Settings} onSelect={onManage}>Manage accounts…</DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Note
      title="New threads sign with the active account; a running thread keeps its own until it is moved."
      text="New threads sign with the active account"
    />
  </DropdownMenu.SubContent>
</DropdownMenu.Sub>
