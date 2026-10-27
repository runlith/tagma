<script lang="ts">
  import ArrowUpToLine from '@lucide/svelte/icons/arrow-up-to-line';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Clock from '@lucide/svelte/icons/clock';
  import FoldVertical from '@lucide/svelte/icons/fold-vertical';
  import Inbox from '@lucide/svelte/icons/inbox';
  import Pause from '@lucide/svelte/icons/pause';
  import Pencil from '@lucide/svelte/icons/pencil';
  import X from '@lucide/svelte/icons/x';
  import { isThreadPicture } from '@runlith/agent/transcript/attachments';
  import { firstLabelLine } from './activity';
  import AttachmentThumb from './AttachmentThumb.svelte';
  import type { AgentSignalNotice } from '@runlith/agent/contracts';
  import type { WordsWait } from '@runlith/agent/transcript/live';
  import { clipFade } from './clipFade';
  import { inStep } from './inStep';
  import NoticeLine from './entries/NoticeLine.svelte';
  import Well from './entries/Well.svelte';
  import { noticeLead, noticeThreads } from './notices';
  import WordsSender from './entries/WordsSender.svelte';
  import FileChip from './FileChip.svelte';
  import { useChatRendering } from './renderers';
  import { type ChatQueuedAttachment, type ChatQueuedTurnItem, ownWords } from './session/FeedVerdicts';
  import { useChatStrings } from './strings';

  type Group = 'next' | 'later';

  type Props = {
    steers: readonly ChatQueuedTurnItem[];
    queued: readonly ChatQueuedTurnItem[];
    steerable: boolean;
    wordsWait?: WordsWait | null;
    stoppable: boolean;
    busyId?: string;
    onUnqueue(id: string): void;
    onEdit(id: string): void;
    onPromote(id: string): void;
  };

  let { steers, queued, steerable, wordsWait = null, stoppable, busyId = undefined, onUnqueue, onEdit, onPromote }: Props = $props();

  const strings = useChatStrings();
  const rendering = useChatRendering();

  const SHOWN = 3;
  const TAKE_BACK = { code: 'ArrowUp', alt: true };
  const ROW_PICTURES = 3;

  const next = $derived(steers.filter(ownWords));
  const mail = $derived(steers.filter((item) => !ownWords(item)));
  const speaks = $derived(next.some((item) => item.kind === 'turn'));
  let opened = $state<string | null>(null);
  let mailOpen = $state(false);
  let whole = $state<Record<Group, boolean>>({ next: false, later: false });

  const shownItems = (key: Group, items: readonly ChatQueuedTurnItem[]) => (whole[key] ? items : items.slice(0, SHOWN));
  const expanded = $derived(
    opened !== null &&
      [...shownItems('next', next), ...shownItems('later', queued), ...(mailOpen ? mail : [])].some((item) => item.id === opened),
  );

  const pictures = (item: ChatQueuedTurnItem) => item.attachments.filter((attachment) => isThreadPicture(attachment.mime));
  const files = (item: ChatQueuedTurnItem) => item.attachments.filter((attachment) => !isThreadPicture(attachment.mime));
  const senderName = (item: ChatQueuedTurnItem) =>
    item.sender === null
      ? null
      : ((item.sender.threadId === undefined ? null : rendering.threadName?.(item.sender.threadId, item.sender.projectId)) ??
        item.sender.name);
  const mailLabel = (item: ChatQueuedTurnItem) => {
    const name = senderName(item);
    if (name === null) return firstLabelLine(item.text);
    const lead = item.intent === null ? null : strings.wordsFrom(item.intent);
    return lead === null ? name : `${lead} ${name}`;
  };
  const noticed = $derived.by(() => {
    const kinds = new Map<AgentSignalNotice['kind'], { readonly first: string; readonly notices: AgentSignalNotice[] }>();
    for (const item of mail) {
      if (item.notice === null) continue;
      const held = kinds.get(item.notice.kind);
      if (held === undefined) kinds.set(item.notice.kind, { first: item.id, notices: [item.notice] });
      else held.notices.push(item.notice);
    }
    return kinds;
  });
  const mailParts = $derived(mail.filter((item) => item.notice === null || noticed.get(item.notice.kind)?.first === item.id));
  const noticeNames = (notices: readonly AgentSignalNotice[]) =>
    noticeThreads(notices, rendering.threadName)
      .map((thread) => thread.title)
      .join(', ');

  function toggle(id: string): void {
    opened = opened === id ? null : id;
  }

  function open(attachment: ChatQueuedAttachment): void {
    rendering.context.openImage(attachment);
  }
</script>

{#snippet line(text: string)}{#if rendering.lineText}{@render rendering.lineText(text)}{:else}{text}{/if}{/snippet}

{#snippet header(group: Group, count: number)}
  <p class="flex h-6 min-w-0 items-center gap-1.5 pr-1 pl-2 text-small text-muted-foreground">
    <span class="grid size-4 shrink-0 place-items-center">
      {#if group === 'next'}
        <span class="size-1.5 animate-breathe bg-chat-queued" {@attach inStep}></span>
      {:else}
        <Clock class="size-3.5" />
      {/if}
    </span>
    <span class="shrink-0">{group === 'next' ? strings.waitingNextStep() : strings.waitingAfterTurn()}</span>
    {#if count > 1}<span class="tabular-nums text-muted-foreground/70">{count}</span>{/if}
    {#if group === 'next' && speaks && stoppable && !rendering.touch}
      <span class="ml-auto flex min-w-0 items-center gap-1.5">
        {@render rendering.key({ code: 'Escape', size: 'sm' })}
        <span class="min-w-0" data-fade {@attach clipFade}>{strings.stopAndSendNow()}</span>
      </span>
    {/if}
  </p>
{/snippet}

{#snippet act(label: string, run: () => void, danger: boolean, icon: 'promote' | 'edit' | 'delete')}
  <button
    type="button"
    class={[
      'grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:size-8',
      danger ? 'hover:bg-hover-danger hover:text-destructive' : 'hover:bg-hover hover:text-foreground',
    ]}
    aria-label={label}
    {@attach rendering.tip(() => ({ text: label, chord: icon === 'edit' ? TAKE_BACK : undefined }))}
    disabled={busyId !== undefined}
    onclick={run}
  >
    {#if icon === 'promote'}
      <ArrowUpToLine class="size-3.5" />
    {:else if icon === 'edit'}
      <Pencil class="size-3.5" />
    {:else}
      <X class="size-3.5" />
    {/if}
  </button>
{/snippet}

{#snippet row(item: ChatQueuedTurnItem, group: Group | 'mail')}
  {@const shown = opened === item.id}
  {@const words = item.kind === 'turn' && item.removable}
  {@const seen = pictures(item)}
  {@const filed = files(item)}
  <div class={['group/row grid rounded-md', shown ? 'bg-hover' : 'hover:bg-hover']}>
    <div class="flex h-8 min-w-0 items-center gap-2 pr-1 pl-2 text-ui">
      <span class="grid size-4 shrink-0 place-items-center text-muted-foreground">
        {#if item.kind === 'compaction'}<FoldVertical class="size-3.5" />{/if}
      </span>
      {#if item.sender !== null}
        <span class="flex min-w-0 max-w-48 shrink-0 text-small text-muted-foreground">
          <WordsSender sender={item.sender} intent={item.intent} />
        </span>
      {:else if group === 'mail' && item.intent !== null}
        <span class="shrink-0 text-small text-muted-foreground">{strings.signal(item.intent, false)}</span>
      {/if}
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        aria-expanded={shown}
        onclick={() => toggle(item.id)}
      >
        {#if item.kind === 'compaction'}<span class="shrink-0 text-foreground">{strings.compactionPending()}</span>{/if}
        {#if shown}
          <span class="text-small text-muted-foreground">{strings.showLess()}</span>
        {:else if item.text}
          <span class={['min-w-0 flex-1', words ? 'text-foreground' : 'text-muted-foreground']} data-fade {@attach clipFade}>
            {#if item.kind === 'compaction'}{strings.compactionKeeping()}
            {/if}{@render line(item.sender === null ? item.text : firstLabelLine(item.text))}
          </span>
        {/if}
      </button>
      {#if !shown}
        {@const more = Math.max(0, seen.length - ROW_PICTURES) + Math.max(0, filed.length - 1)}
        {#each seen.slice(0, ROW_PICTURES) as attachment, index (index)}
          <AttachmentThumb {attachment} size="row" onOpen={() => open(attachment)} />
        {/each}
        {#if filed[0] !== undefined}
          <FileChip name={filed[0].filename ?? strings.attachment()} size="row" />
        {/if}
        {#if more > 0}
          <span
            class="grid size-6 shrink-0 place-items-center rounded-sm border border-border text-meta tabular-nums text-muted-foreground"
          >
            +{more}
          </span>
        {/if}
      {/if}
      {#if item.removable}
        <span
          class={[
            'flex shrink-0 items-center gap-0.5',
            !shown &&
              'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100',
          ]}
        >
          {#if words && group === 'later' && steerable}
            {@render act(strings.sendAtNextStep(), () => onPromote(item.id), false, 'promote')}
          {/if}
          {#if words}
            {@render act(strings.editInField(), () => onEdit(item.id), false, 'edit')}
          {/if}
          {@render act(strings.delete(), () => onUnqueue(item.id), true, 'delete')}
        </span>
      {/if}
    </div>
    {#if shown}
      <div class="grid min-w-0 gap-2 pr-2 pb-2 pl-8">
        {#if item.text && item.sender !== null}
          <div class="min-w-0 text-foreground">
            {@render rendering.markdown({ cacheKey: item.id, size: 'ui', text: item.text })}
          </div>
        {:else if item.text && group === 'mail'}
          <Well id={item.id} text={item.text} />
        {:else if item.text}
          <div class="min-w-0 whitespace-pre-wrap break-words text-ui text-foreground">
            {#if rendering.userText}{@render rendering.userText(item.text)}{:else}{item.text}{/if}
          </div>
        {/if}
        {#if seen.length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each seen as attachment, index (index)}
              <AttachmentThumb {attachment} size="tile" onOpen={() => open(attachment)} />
            {/each}
          </div>
        {/if}
        {#if filed.length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each filed as attachment, index (index)}
              <FileChip name={attachment.filename ?? strings.attachment()} href={attachment.url} />
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet group(key: Group, items: readonly ChatQueuedTurnItem[])}
  {@render header(key, items.length)}
  {#each shownItems(key, items) as item (item.id)}
    {@render row(item, key)}
  {/each}
  {#if items.length > SHOWN}
    <button
      type="button"
      class="flex h-6 cursor-pointer items-center rounded-md pr-1 pl-8 text-left text-small text-muted-foreground hover:bg-hover"
      onclick={() => (whole[key] = !whole[key])}
    >
      {whole[key] ? strings.showLess() : strings.moreWaiting(items.length - SHOWN)}
    </button>
  {/if}
{/snippet}

{#if steers.length > 0 || queued.length > 0 || wordsWait !== null}
  <section
    class={[
      'relative mx-3 -mb-6 grid max-h-80 gap-1 overflow-y-auto rounded-t-lg border border-b-0 border-border bg-chat-raised px-1.5 pt-1.5 pb-6',
      expanded && 'overscroll-contain',
    ]}
    data-scrollable
  >
    {#if wordsWait !== null}
      <p class="flex h-6 min-w-0 items-center gap-1.5 pr-1 pl-2 text-small text-muted-foreground">
        <span class="grid size-4 shrink-0 place-items-center"><Pause class="size-3.5" /></span>
        <span class="min-w-0" data-fade {@attach clipFade}>{strings.wordsWait(wordsWait)}</span>
      </p>
    {/if}
    {#if next.length > 0}
      <div class="grid">{@render group('next', next)}</div>
    {/if}
    {#if queued.length > 0}
      <div class="grid">{@render group('later', queued)}</div>
    {/if}
    {#if mail.length > 0}
      <div class="grid">
        <button
          type="button"
          class="flex h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md pr-2 pl-2 text-left text-small text-muted-foreground hover:bg-hover"
          aria-expanded={mailOpen}
          onclick={() => (mailOpen = !mailOpen)}
        >
          <span class="grid size-4 shrink-0 place-items-center"><Inbox class="size-3.5" /></span>
          <span class="shrink-0">{strings.agentReadsNext()}</span>
          <span class="shrink-0 tabular-nums text-muted-foreground/70">{mail.length}</span>
          {#if mailOpen}
            <span class="flex-1"></span>
          {:else}
            <span class="flex min-w-0 flex-1 gap-x-3 text-foreground/80" data-fade {@attach clipFade}>
              {#each mailParts as item (item.id)}
                {#if item.notice === null}
                  <span class="shrink-0">{@render line(mailLabel(item))}</span>
                {:else}
                  {@const notices = noticed.get(item.notice.kind)?.notices ?? [item.notice]}
                  {@const names = noticeNames(notices)}
                  <span class="flex shrink-0 gap-x-1.5">
                    {#each noticeLead(notices, strings) as part, index (index)}<span class="font-medium text-foreground">{part}</span
                      >{/each}
                    {#if names}<span class="text-muted-foreground">{names}</span>{/if}
                  </span>
                {/if}
              {/each}
            </span>
          {/if}
          <ChevronDown class={['size-3.5 shrink-0 transition-transform', mailOpen && 'rotate-180']} />
        </button>
        {#if mailOpen}
          {#each mail as item (item.id)}
            {#if item.notice === null}
              {@render row(item, 'mail')}
            {:else}
              <NoticeLine id={item.id} notice={item.notice} at={item.at || undefined} text={item.text} />
            {/if}
          {/each}
        {/if}
      </div>
    {/if}
  </section>
{/if}
