<script lang="ts">
  import { untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import ActivityStep from './ActivityStep.svelte';
  import ActivityStretch from './ActivityStretch.svelte';
  import type { ChatRowView } from './rowEstimate';
  import type { VisibleFeed } from './VisibleFeed';
  import { TimelineFold } from './TimelineFold';
  import { type ChatTailSlot, type ChatTimelineItem, stretchOnScreen, timelineItemPlace, timelineItemRewound } from './timeline';
  import RewindRow from './RewindRow.svelte';
  import { type ChatThreadPhase, chatHeroVisible, chatThreadId } from './chatThreadPhase';
  import { dayLabel, messageTime } from './chatTime';
  import type { ChatLiveStatus, ChatLiveTail } from './liveStatus';
  import type { FeedReading, RunVerdict } from './session/FeedVerdicts';
  import LiveRunRow from './LiveRunRow.svelte';
  import MessageNav from './MessageNav.svelte';
  import Waiting from './Waiting.svelte';
  import type { ChatEntryOf } from './renderers';
  import { useChatRendering } from './renderers';
  import { useChatStrings } from './strings';
  import type { ChatNotice } from './notice';
  import type { ChatInterlude } from './surface';
  import Callout from './Callout.svelte';
  import TranscriptRow from './TranscriptRow.svelte';
  import UnknownEntryRow from './entries/UnknownEntryRow.svelte';
  import type { TranscriptViewport } from './TranscriptViewport.svelte';

  const NOTICE_KEY = 'transcript:notice';
  const FEED_BOTTOM_GAP_PX = 16;

  type Props = {
    feed: VisibleFeed;
    feedEpoch: number;
    entryCount: number;
    trailingReadyAnswers: ChatEntryOf<'ready-answers'> | null;
    awaitingConfirmation: boolean;
    verdict: RunVerdict | null;
    liveStatus: ChatLiveStatus | null;
    tail: ChatLiveTail | null;
    now: number;
    reading: FeedReading;
    notice?: ChatNotice | null;
    onDismissNotice?: () => void;
    thread: ChatThreadPhase;
    emptyStateTitle?: string;
    emptyStateDetail?: string;
    starters?: readonly string[];
    clearance: number;
    hasOlder?: boolean;
    loadOlder?: () => Promise<boolean>;
    viewport: TranscriptViewport;
    keyboard?: boolean;
    onDraft(value: string): void;
    onSend(): boolean | void | Promise<boolean> | Promise<void>;
  };

  let {
    feed,
    feedEpoch,
    entryCount,
    trailingReadyAnswers,
    awaitingConfirmation,
    verdict,
    liveStatus,
    tail,
    now,
    reading,
    notice = null,
    onDismissNotice,
    thread,
    emptyStateTitle,
    emptyStateDetail,
    starters = [],
    clearance,
    hasOlder = false,
    loadOlder,
    viewport,
    keyboard = true,
    onDraft,
    onSend,
  }: Props = $props();

  const strings = useChatStrings();
  const rendering = useChatRendering();

  let root: HTMLDivElement | undefined = $state();
  let content: HTMLDivElement | undefined = $state();
  let list: HTMLDivElement | undefined = $state();
  const virtualizer = $derived(viewport.window);
  const still = $derived(reading.kind !== 'live');

  const rows = new TimelineFold(rendering.kinds);
  const users = $derived.by(() => {
    feedEpoch;
    return feed.users;
  });
  const newestLive = $derived(tail?.kind === 'step' ? tail.entry.id : null);
  const activeRunId = $derived(verdict?.runId ?? null);
  const working = $derived(verdict?.pulse ?? false);
  const pulse = $derived(liveStatus?.pulse ?? false);
  const showReadyAnswers = $derived(Boolean(trailingReadyAnswers) && !working);
  const showLiveStatus = $derived(tail?.kind === 'status');
  const showNotice = $derived(Boolean(notice));
  let lostOnScreen: string | null = null;
  let newestBefore: string | null = null;
  let newestSeen = false;
  const rowView: ChatRowView = $derived.by(() => {
    rendering.context.revision;
    return {
      metrics: virtualizer.metrics,
      expanded: (key, fallback) => rendering.context.expanded(key, fallback),
      stretchDefault: (key, newest) => rendering.context.stretchDefault(key, newest || (newestSeen && key === newestBefore)),
      toolOpen: (name) => rendering.kinds.toolOpen(name),
    };
  });
  const tailSlots = $derived.by((): readonly ChatTailSlot[] => [
    ...(showReadyAnswers ? (['ready-answers'] as const) : []),
    ...(showNotice ? (['notice'] as const) : []),
  ]);
  const timeline = $derived.by(() => {
    rendering.kinds.stamp();
    feedEpoch;
    newestBefore = rows.newestKey;
    const visible = untrack(() => virtualizer.visibleKeys);
    newestSeen = newestBefore !== null && stretchOnScreen((key) => rows.item(key), newestBefore, visible);
    rows.sync(feed, rowView, activeRunId ? { runId: activeRunId, status: showLiveStatus } : null, tailSlots);
    lostOnScreen = newestSeen && rows.newestKey !== newestBefore ? newestBefore : null;
    return rows.revision;
  });
  const timelineCount = $derived.by(() => {
    timeline;
    return rows.count;
  });
  const newestStretchKey = $derived.by(() => {
    timeline;
    return rows.newestKey;
  });
  const growingStretchKey = $derived(working && activeRunId ? newestStretchKey : null);

  function timelineItem(key: string): ChatTimelineItem | undefined {
    timeline;
    return rows.item(key);
  }

  $effect(() => {
    timeline;
    const lost = lostOnScreen;
    if (lost === null) return;
    lostOnScreen = null;
    rendering.context.hold(lost);
  });

  $effect(() => {
    const visible = virtualizer.visibleKeys;
    timeline;
    const gone = rendering.context.held.filter((key) => !stretchOnScreen((shown) => rows.item(shown), key, visible));
    if (gone.length === 0) return;
    untrack(() => {
      for (const key of gone) rendering.context.release(key);
    });
  });
  const interludesAfter = $derived.by(() => {
    const at = new Map<string, ChatInterlude[]>();
    for (const interlude of rendering.regions.interludes) {
      const after = interlude.after();
      if (after === null) continue;
      const held = at.get(after);
      if (held === undefined) at.set(after, [interlude]);
      else held.push(interlude);
    }
    return at;
  });
  const hero = $derived(rendering.regions.heroes[0] ?? null);
  const showEmptyState = $derived(
    chatHeroVisible({
      phase: thread,
      entries: entryCount,
      hasCopy: hero !== null || Boolean(emptyStateTitle || emptyStateDetail || starters.length > 0),
      working,
      awaitingConfirmation,
    }),
  );
  $effect(() => {
    viewport.openThread(chatThreadId(thread));
  });

  $effect(() => {
    viewport.attach(root);
  });

  $effect(() => {
    timeline;
    const input = {
      root,
      list,
      model: rows,
      shape: rows.shape,
      clearance: clearance + FEED_BOTTOM_GAP_PX,
      disclosure: rendering.context.revision,
    };
    untrack(() => virtualizer.sync(input));
  });

  let loadingOlder = false;

  function askForOlder(): Promise<boolean> | null {
    if (loadingOlder || !hasOlder || !loadOlder) return null;
    loadingOlder = true;
    return loadOlder().finally(() => {
      loadingOlder = false;
    });
  }

  $effect(() => {
    viewport.useHead(askForOlder);
    viewport.useFill(askForOlder);
  });

  $effect(() => {
    viewport.useMessages(() => users);
  });

  $effect(() => {
    viewport.syncAnchor();
  });

  $effect(() => {
    viewport.syncWorking(working);
  });

  $effect(() => {
    timeline;
    const count = feed.rows.length;
    untrack(() => void viewport.contentChanged(count, activeRunId));
  });

  $effect(() => {
    const height = clearance;
    untrack(() => viewport.syncClearance(height));
  });

  $effect(() => {
    const element = content;
    const scroller = root;
    if (!element || !scroller || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      virtualizer.remeasure();
      viewport.resized();
    });
    observer.observe(element);
    observer.observe(scroller);
    return () => observer.disconnect();
  });

  $effect(() => {
    const element = content;
    if (!element || typeof document === 'undefined') return;

    let focused: string | undefined;
    let ends: readonly string[] = [];
    const keyOf = (node: Node | null | undefined): string | undefined =>
      (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-timeline-key]')?.dataset.timelineKey;
    const keep = () => virtualizer.keep(focused === undefined ? ends : [focused, ...ends]);
    const syncSelection = () => {
      const selection = window.getSelection();
      viewport.syncSelection(selection, element);
      const inside = selection !== null && !selection.isCollapsed;
      ends = inside ? [keyOf(selection.anchorNode), keyOf(selection.focusNode)].filter((key) => key !== undefined) : [];
      keep();
    };
    const focusIn = (event: FocusEvent) => {
      focused = keyOf(event.target as Node | null);
      keep();
    };
    const focusOut = (event: FocusEvent) => {
      if (element.contains(event.relatedTarget as Node | null)) return;
      focused = undefined;
      keep();
    };
    const pressed = (event: MouseEvent) => {
      const control = (event.target as Element | null)?.closest<HTMLElement>('[aria-expanded], summary');
      if (control && element.contains(control)) virtualizer.press(control);
    };
    document.addEventListener('selectionchange', syncSelection);
    element.addEventListener('focusin', focusIn);
    element.addEventListener('focusout', focusOut);
    element.addEventListener('click', pressed, true);
    return () => {
      document.removeEventListener('selectionchange', syncSelection);
      element.removeEventListener('focusin', focusIn);
      element.removeEventListener('focusout', focusOut);
      element.removeEventListener('click', pressed, true);
    };
  });

  function measureRow(node: HTMLElement): void {
    virtualizer.measureRow(node);
  }

  function navigationTargetEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (!keyboard || navigationTargetEditable(event.target)) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier || !event.altKey || event.shiftKey || event.defaultPrevented) return;
    if (event.key !== '[' && event.key !== ']') return;

    event.preventDefault();
    event.stopPropagation();
    viewport.navigate(
      event.key === '[' ? -1 : 1,
      users.map((entry) => entry.id),
    );
  }

  function sendReadyAnswer(send: string): void {
    onDraft(send);
    void onSend();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#snippet tailRow(slot: ChatTailSlot)}
  {#if slot === 'ready-answers' && trailingReadyAnswers}
    <div class="mr-auto flex min-w-0 max-w-feed flex-wrap gap-1.5">
      {#each trailingReadyAnswers.answers as answer, index (`${trailingReadyAnswers.id}:${index}`)}
        <button
          type="button"
          class="cursor-pointer rounded-full border border-border bg-background/65 px-3 py-1.5 pointer-coarse:min-h-11 text-ui font-semibold text-foreground transition hover:bg-hover"
          onclick={() => sendReadyAnswer(answer.send)}
        >
          {answer.label}
        </button>
      {/each}
    </div>
  {:else if slot === 'notice' && notice}
    {@const told = notice.told}
    {@const open = rendering.context.expanded(NOTICE_KEY)}
    {@const detailed = (told?.details?.length ?? 0) > 0 || told?.code !== undefined}
    {#snippet noticeActions()}
      {#if told?.act !== undefined}
        {@const act = told.act}
        <button
          type="button"
          class="inline-flex h-6 cursor-pointer items-center rounded-md bg-primary px-2 text-small font-medium text-primary-foreground transition-opacity hover:opacity-90"
          onclick={() => act.run()}>{act.label}</button
        >
      {/if}
      {#if detailed}
        <button
          type="button"
          class="inline-flex cursor-pointer items-center rounded-md px-1.5 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          aria-expanded={open}
          onclick={() => rendering.context.setExpanded(NOTICE_KEY, !open)}
        >
          {open ? strings.showLess() : strings.showDetails()}
        </button>
      {/if}
    {/snippet}
    <Callout
      tone={notice.tone === 'error' ? 'error' : 'plain'}
      title={notice.message}
      note={told?.note}
      onDismiss={onDismissNotice}
      dismissLabel={strings.close()}
      class="bg-background"
      actions={told?.act !== undefined || detailed ? noticeActions : undefined}
    >
      {#if open && detailed}
        <div class="grid min-w-0 gap-0.5 select-text">
          {#each told?.details ?? [] as line, index (index)}
            <p class="text-small wrap-anywhere text-muted-foreground">{line}</p>
          {/each}
          {#if told?.code !== undefined}<p class="font-mono text-meta wrap-anywhere text-muted-foreground">{told.code}</p>{/if}
        </div>
      {/if}
    </Callout>
  {/if}
{/snippet}

<div class="@container/feed relative h-full min-h-0" style={`--chat-composer-clearance:${clearance}px`}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={root}
    class="@container h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-4 mask-b-from-[calc(100%_-_var(--chat-composer-clearance))] mask-b-to-100%"
    data-scrollable=""
    role="group"
    tabindex="-1"
  >
    <div
      bind:this={content}
      class={[
        'mx-auto grid max-w-none gap-3 @min-[34rem]:max-w-3xl @min-[34rem]:gap-4',
        showEmptyState && '@min-[34rem]:min-h-full @min-[34rem]:content-center',
        thread.kind === 'opening' && 'min-h-full place-items-center content-center',
      ]}
    >
      {#if showEmptyState}
        <div
          class="flex min-h-[28vh] items-start justify-center pt-4 @min-[34rem]:min-h-[36vh] @min-[34rem]:items-center @min-[34rem]:pt-0"
        >
          {#if hero !== null}
            {#key hero.id}
              <div class="flex w-full justify-center" in:fade={{ duration: 160 }}>{@render hero.body()}</div>
            {/key}
          {:else}
            <div class="grid w-full max-w-xl justify-items-start gap-5 @min-[34rem]:justify-items-center" in:fade={{ duration: 160 }}>
              {#if emptyStateTitle || emptyStateDetail}
                <div class="grid gap-1 text-left @min-[34rem]:text-center">
                  {#if emptyStateTitle}<p class="text-page text-foreground">{emptyStateTitle}</p>{/if}
                  {#if emptyStateDetail}<p class="text-ui text-muted-foreground">{emptyStateDetail}</p>{/if}
                </div>
              {/if}
              {#if starters.length > 0}
                <div class="flex flex-wrap justify-start gap-1.5 @min-[34rem]:justify-center">
                  {#each starters as starter (starter)}
                    <button
                      type="button"
                      class="min-w-0 cursor-pointer rounded-full border border-border px-3 py-1.5 pointer-coarse:min-h-11 text-small text-muted-foreground transition-colors hover:border-input hover:bg-hover hover:text-foreground"
                      onclick={() => onDraft(starter)}
                    >
                      {starter}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if thread.kind === 'opening'}
        <Waiting class="size-4 text-muted-foreground" label={strings.openingThread()} />
      {/if}

      {#if thread.kind === 'unreadable' && verdict === null}
        {@const lost = reading.kind === 'lost'}
        <div class="mx-auto w-full max-w-3xl" data-feed-still={reading.kind}>
          <Callout
            tone={lost ? 'plain' : 'error'}
            title={lost ? strings.livePhase('reconnecting', null) : strings.threadUnreadable()}
            class="bg-background"
          >
            <ul class="grid gap-1">
              {#each thread.errors as error, index (`${index}:${error}`)}
                <li class="text-body leading-relaxed break-words text-foreground">{error}</li>
              {/each}
            </ul>
            <div class="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-small text-muted-foreground">
              <span class="font-mono text-meta">{thread.threadId}</span>
              {#if reading.kind !== 'live' && reading.asOf !== null}<span
                  >{strings.feedAsOf(messageTime(reading.asOf, strings.locale))}</span
                >{/if}
              {#if reading.kind !== 'live' && reading.kind !== 'closed'}<span>{strings.feedRetrying()}</span>{/if}
            </div>
          </Callout>
        </div>
      {/if}

      {#if timelineCount > 0}
        <div bind:this={list} class="relative w-full">
          {#each virtualizer.rows as row (row.key)}
            {@const item = timelineItem(String(row.key))}
            {#if item}
              <TranscriptRow
                rowKey={String(row.key)}
                place={timelineItemPlace(item)}
                box={virtualizer.box}
                spaced={item.spaced}
                dim={timelineItemRewound(item)}
                inert={virtualizer.heldKeys.has(String(row.key))}
                measure={measureRow}
              >
                {#if item.kind === 'tail'}
                  {@render tailRow(item.slot)}
                {:else if item.kind === 'status'}
                  {#if liveStatus}
                    <LiveRunRow status={liveStatus} place={item.place} />
                  {/if}
                {:else}
                  {#if item.dayBefore}
                    <div class="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center @min-[34rem]:mb-4">
                      <div class="h-px bg-border/70"></div>
                      <span class="text-small text-muted-foreground/70">{dayLabel(item.dayBefore, strings.locale)}</span>
                      <div class="h-px bg-border/70"></div>
                    </div>
                  {/if}
                  {#if item.kind === 'rewind'}
                    {#if rendering.rewind}
                      <RewindRow {item} rewind={rendering.rewind} context={rendering.context} />
                    {/if}
                  {:else if item.kind === 'stretch'}
                    <ActivityStretch
                      group={item.group}
                      thoughts={item.thoughts}
                      newest={item.key === newestStretchKey}
                      growing={item.key === growingStretchKey && item.group.id === activeRunId}
                    />
                  {:else if item.kind === 'step'}
                    <ActivityStep
                      row={item.row}
                      stretch={item.stretch}
                      bare={item.bare}
                      place={item.place}
                      newest={item.live || item.stretch === newestStretchKey}
                      live={item.live}
                      clock={item.live && pulse ? liveStatus : null}
                      phaseClock={item.live && item.key === newestLive}
                      {now}
                      {still}
                    />
                  {:else}
                    {@const renderer = rendering.kinds.renderer(item.entry)}
                    {@const view = item.entry.kind === 'tool' ? rendering.kinds.toolView(item.entry) : undefined}
                    {#if view && item.entry.kind === 'tool'}
                      <ActivityStep row={{ kind: 'step', key: item.entry.id, entry: item.entry }} place="only" {now} {still} />
                      <div class="mt-1.5">{@render view(item.entry, rendering.context)}</div>
                    {:else if renderer}
                      {@render renderer(item.entry, rendering.context)}
                    {:else if !rendering.kinds.classify(item.entry).hidden}
                      <UnknownEntryRow entry={item.entry} />
                    {/if}
                    {#each interludesAfter.get(item.entry.id) ?? [] as interlude (interlude.id)}
                      <div class="mt-3 @min-[34rem]:mt-4">
                        {@render interlude.body(rendering.context)}
                      </div>
                    {/each}
                  {/if}
                {/if}
              </TranscriptRow>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <div
    class="pointer-events-none absolute top-0 left-3 z-20 hidden flex-col justify-center @min-[56rem]/feed:flex"
    style:bottom="var(--chat-composer-clearance)"
  >
    <MessageNav {users} currentId={viewport.currentMessageId} onSelect={(id) => viewport.select(id)} />
  </div>
</div>
