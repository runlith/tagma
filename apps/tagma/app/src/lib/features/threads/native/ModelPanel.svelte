<script lang="ts">
  import type { ComposerPanel } from '@runlith/chat-ui/composer';
  import type { ModelSwitches } from '@runlith/llm/models/description';
  import { CountdownClock } from '$lib/features/providers/accounts/CountdownClock.svelte.js';
  import QuotaHeading from '$lib/features/providers/usage/QuotaHeading.svelte';
  import { Favorites } from '../Favorites.svelte.js';
  import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { billedLabel } from '$lib/features/providers/served.js';
  import ModelCatalogList from '$lib/features/providers/models/CatalogList.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { choiceKey, type ModelChoice, type ModelFlag, type ModelGesture } from '$lib/shared/models/choice.js';
  import { coldWords, type ColdBasis } from './coldWords.js';
  import { compactionDetail, compactionList } from './compactionWords.js';
  import PickerHeading from './PickerHeading.svelte';
  import type { ChatHold } from '../ChatHold.svelte.js';
  import type { ModelPanelState } from '../ModelPanelState.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import { ThreadCompaction } from '../thread/ThreadCompaction.svelte.js';
  import type { ThreadViews } from '../thread/ThreadViews.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import { warmthFilled } from '../warmthWords.js';

  let {
    shown,
    chat,
    views,
    writes,
    panel,
    door,
    closesOutside = true,
  }: {
    shown: ShownThread;
    chat: ChatHold;
    views: ThreadViews;
    writes: ThreadWrites;
    panel: ModelPanelState;
    door: ComposerPanel;
    closesOutside?: boolean;
  } = $props();

  const accounts = UsageAccounts.use();
  const catalog = ProviderCatalog.use();
  const favorites = Favorites.use();
  const clock = CountdownClock.use();
  $effect(() => clock.watch());

  let root: HTMLDivElement | undefined = $state();
  let signing = $state<Record<string, string | null>>({});
  let opened = $state<string | null>(null);

  const current = $derived(panel.current);
  const settings = $derived(views.model.settings);
  const models = $derived(views.model.modelList);
  const choosing = $derived(shown.lease?.find(ThreadCompaction) ?? null);
  const read = $derived(choosing?.choices ?? null);
  const unread = $derived(choosing?.unread ?? null);
  const compaction = $derived(read === null ? null : compactionList(catalog.models, read, favorites.list, clock.now));
  const pending = $derived.by<readonly ModelChoice[]>(() => {
    const own = models?.choices.find((choice) => choiceKey(choice.provider, choice.model) === models.current);
    const flag: ModelFlag =
      unread === null ? { text: 'reading the choices…', tone: 'muted' } : { text: 'the choices were not read', tone: 'bad' };
    return own === undefined ? [] : [{ ...own, meta: undefined, flags: [flag] }];
  });
  const cold = $derived.by<ColdBasis | null>(() => {
    const session = chat.session;
    const thread = session?.thread ?? null;
    if (session === null || thread === null) return null;
    const queued = [...session.queued, ...session.pendingSteers].some((item) => item.kind === 'compaction');
    return {
      reading: thread.contextReading ?? null,
      warm: session.activeRunId !== null || warmthFilled(thread.cacheWarmth ?? null, () => clock.now),
      account: thread.account ?? null,
      compacting: queued || session.runPhase?.phase === 'compacting',
    };
  });

  function close(): void {
    panel.close();
    door.returnFocus();
  }

  function choose(choice: ModelChoice, rung: string | null, _gesture: ModelGesture, switches: ModelSwitches): void {
    close();
    const account = choice.provider === settings?.provider ? undefined : signing[choice.provider];
    void writes.applyModel(choice.provider, choice.model, rung, { switches, account });
  }

  function reorder(choice: ModelChoice, before: ModelChoice | null): void {
    void favorites.move(choice, before);
  }

  function compactWith(choice: ModelChoice, rung: string | null, gesture: ModelGesture): void {
    close();
    writes.compactWith(choice.provider, choice.model, rung, gesture);
  }

  function shownAccount(provider: string): string | null {
    if (settings !== null && provider === settings.provider) return settings.account === '' ? null : settings.account;
    return signing[provider] ?? null;
  }

  function signWith(provider: string, account: string | null): void {
    opened = null;
    if (settings !== null && provider === settings.provider) void writes.applyAccount(account);
    else signing = { ...signing, [provider]: account };
  }

  $effect(() => {
    if (!closesOutside) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || root?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-panel-door]') !== null) return;
      panel.close();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      if (root?.contains(document.activeElement)) door.returnFocus();
    };
  });
</script>

{#snippet quota(provider: string, label: string)}
  <div class="eyebrow flex min-w-0 items-center gap-1.5 px-2 pt-2 pb-1 text-muted-foreground">
    <QuotaHeading {provider} label={billedLabel(catalog.models, provider, label)} now={clock.now} />
  </div>
{/snippet}

{#snippet signer(provider: string, label: string)}
  <PickerHeading
    {provider}
    {label}
    now={clock.now}
    shown={shownAccount(provider)}
    here={provider === settings?.provider}
    pinned={provider === settings?.provider && settings.accountPinned}
    open={opened === provider}
    busy={settings?.busy ?? false}
    ontoggle={() => (opened = opened === provider ? null : provider)}
    onchoose={(account) => signWith(provider, account)}
  />
{/snippet}

{#snippet coldRead(choice: ModelChoice, rung: string | null)}
  {@const standing = choiceKey(choice.provider, choice.model) === models?.current && rung === choice.rung}
  {@const words =
    cold === null || standing ? null : coldWords(catalog.models, cold, { provider: choice.provider, model: choice.model, rung }, clock.now)}
  {#if words !== null}
    <FadeText data-yield class="text-small text-muted-foreground" text={words} />
  {/if}
{/snippet}

{#snippet compactDetail(choice: ModelChoice)}
  {@const row = compaction?.rows.get(choiceKey(choice.provider, choice.model))}
  {#if read !== null && row !== undefined}
    {compactionDetail(catalog.models, read, row, accounts.rows, clock.now)}
  {:else if read === null && unread !== null}
    {unread}
  {:else}
    The summarizer is decided when the request is taken
  {/if}
{/snippet}

<div bind:this={root} data-model-panel>
  {#if current !== null}
    {#key current.opening}
      {#if current.mode === 'model'}
        {#if models !== null && settings !== null}
          <ModelCatalogList
            choices={models.choices}
            lead={models.lead}
            current={models.current}
            starred={models.starred}
            query={current.query}
            busy={settings.busy}
            heading={signer}
            cost={coldRead}
            onpick={choose}
            onstar={(provider, model) => void favorites.toggle(provider, model)}
            onreorder={reorder}
            onswitch={(_choice, id, value) => void writes.applySwitch(id, value)}
            onclose={close}
          />
        {/if}
      {:else}
        <ModelCatalogList
          choices={compaction?.choices ?? pending}
          lead={compaction?.lead ?? []}
          current={compaction === null ? (models?.current ?? null) : compaction.current}
          starred={models?.starred ?? []}
          query={current.query}
          title="Compact with"
          queueAction={chat.commands.runId === null ? null : 'after this run'}
          busy={chat.commands.pending}
          heading={quota}
          detail={compactDetail}
          onpick={compactWith}
          onstar={(provider, model) => void favorites.toggle(provider, model)}
          onreorder={reorder}
          onclose={close}
        />
      {/if}
    {/key}
  {/if}
</div>
