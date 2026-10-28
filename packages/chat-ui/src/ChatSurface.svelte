<script lang="ts" generics="TDraft, TThread extends ChatThreadView">
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import { Effect } from 'effect';
  import { onDestroy, untrack } from 'svelte';
  import ChatComposerOverlay from './ChatComposerOverlay.svelte';
  import { ChatEntryView } from './ChatEntryView.svelte';
  import ChatTranscript from './ChatTranscript.svelte';
  import { type ComposerHandler, settled } from './composer';
  import ChatContextUsagePill from './ChatContextUsagePill.svelte';
  import { chatContextSource, chatContextUsageMetrics } from './contextUsage';
  import { elapsedDuration } from './chatTime';
  import { chatLiveStatus, chatLiveTail } from './liveStatus';
  import ComposerDock from './ComposerDock.svelte';
  import type { ComposerContributions } from './ComposerContributions.svelte';
  import type { ChatAttachment, ChatQuestionAnswer } from './entries';
  import { registerBuiltinKinds } from './builtinKinds';
  import type { EntryKinds } from './EntryKinds.svelte';
  import { VisibleFeed } from './VisibleFeed';
  import type { PromptHandle } from './PromptHandle.svelte';
  import AssistantMessageRow from './entries/AssistantMessageRow.svelte';
  import CompactionRow from './entries/CompactionRow.svelte';
  import RetryRow from './entries/RetryRow.svelte';
  import EntryDisclosure from './entries/EntryDisclosure.svelte';
  import ErrorRow from './entries/ErrorRow.svelte';
  import UnreadableRow from './entries/UnreadableRow.svelte';
  import InterruptionRow from './entries/InterruptionRow.svelte';
  import QuestionRow from './entries/QuestionRow.svelte';
  import RestartRow from './entries/RestartRow.svelte';
  import RetiredReadyAnswersRow from './entries/RetiredReadyAnswersRow.svelte';
  import SignalRow from './entries/SignalRow.svelte';
  import ToolRow from './entries/ToolRow.svelte';
  import UserMessageRow from './entries/UserMessageRow.svelte';
  import Well from './entries/Well.svelte';
  import WordsRow from './entries/WordsRow.svelte';
  import ImageViewer from './ImageViewer.svelte';
  import PinnedRegion from './PinnedRegion.svelte';
  import type { FeedMemory } from './FeedMemory';
  import { FileIntake } from './fileIntake.svelte';
  import RunEndRow from './RunEndRow.svelte';
  import { type ChatEntryContext, type ChatEntryOf, provideChatRendering } from './renderers';
  import { chatThreadId } from './chatThreadPhase';
  import { rewindChip, rewindTargets } from './rewind';
  import { useChatStrings } from './strings';
  import type { ChatNavigation, ChatPreferences, ChatSurfaceRendering } from './surface';
  import { TranscriptViewport } from './TranscriptViewport.svelte';
  import { feedClock, LIVE_FEED } from './session/FeedVerdicts';
  import type { TurnCommands } from './session/TurnCommands.svelte';
  import type { ChatThreadView } from './wire/ChatConnection';

  type Props = {
    turns: TurnCommands<TDraft, TThread>;
    kinds: EntryKinds;
    composer: ComposerContributions;
    memory: FeedMemory;
    rendering: ChatSurfaceRendering;
    navigation: ChatNavigation;
    preferences: ChatPreferences;
    handle: PromptHandle;
  };

  let { turns, kinds, composer, memory, rendering, navigation, preferences, handle }: Props = $props();

  const strings = useChatStrings();

  let clearance = $state(0);
  let dock: ReturnType<typeof ComposerDock> | undefined = $state();

  const thread = $derived(turns.target);
  const session = $derived(turns.session);
  const opening = $derived(turns.opening);
  const entries = $derived(thread.fold.entries);
  const verdict = $derived(session?.verdict ?? null);
  const reading = $derived(session?.feed ?? LIVE_FEED);
  let ticked = $state(Date.now());
  const now = $derived(feedClock(reading, ticked));
  const liveStatus = $derived(chatLiveStatus(verdict, now));
  const activeRunId = $derived(verdict?.runId ?? null);
  const working = $derived(verdict?.pulse ?? false);
  const alive = $derived(verdict?.alive ?? false);
  const halt = $derived(turns.halt);
  const draft = $derived(turns.draft.textOf(turns.draft.current));
  const feed = $derived(new VisibleFeed(kinds));

  const view = new ChatEntryView(
    untrack(() => memory),
    {
      fold: () => thread.fold,
      copyText: (text) => rendering.copyText(text),
      copyImage: (image) => rendering.copyImage(image),
      saveImage: (image) => rendering.saveImage(image),
      verbose: {
        read: () => preferences.verbose.read(),
        write: (value) => preferences.verbose.write(value),
      },
      stretches: {
        read: () => preferences.stretches.read(),
        write: (value) => preferences.stretches.write(value),
      },
      disclosure: {
        read: () => preferences.disclosure.read(),
        write: (rows) => preferences.disclosure.write(rows),
      },
    },
  );
  export function openImage(image: ChatAttachment): void {
    view.openImage(image);
  }

  const viewport = new TranscriptViewport(untrack(() => memory));
  let feedEpoch = $state(0);
  const trailingReadyAnswers = $derived.by(() => {
    feedEpoch;
    return feed.trailing;
  });
  const openConfirmations = $derived.by(() => {
    feedEpoch;
    return feed.confirmations;
  });
  const tail = $derived.by(() => {
    feedEpoch;
    return chatLiveTail(liveStatus, feed.live.at(feed.live.length - 1));
  });
  const intake = new FileIntake(() => (composer.attachments.length === 0 ? undefined : takeFiles));

  $effect(() => {
    view.openThread(chatThreadId(thread.threadPhase));
  });

  $effect(() => {
    if (!activeRunId || reading.kind !== 'live') return;
    ticked = Date.now();
    const timer = setInterval(() => {
      ticked = Date.now();
    }, 1_000);
    return () => clearInterval(timer);
  });

  $effect.pre(() =>
    registerBuiltinKinds(kinds, {
      assistant: assistantRow,
      compaction: compactionRow,
      context: contextStep,
      error: errorRow,
      unreadable: unreadableRow,
      interruption: interruptionRow,
      restart: restartRow,
      question: questionRow,
      reasoning: reasoningStep,
      retry: retryRow,
      'run-end': runEndRow,
      'runtime-guidance': guidanceStep,
      signal: signalEntry,
      'ready-answers': readyAnswersRow,
      'system-prompt': systemPromptRow,
      tool: toolRow,
      user: userRow,
      words: wordsRow,
    }),
  );

  $effect.pre(() => {
    feed.sync(thread.fold, view.verbose, verdict ? { id: verdict.runId, phase: verdict.phase } : null);
    feedEpoch = feed.epoch;
  });

  $effect.pre(() => {
    const disposers = [
      composer.command('chat', {
        name: 'verbose',
        description: strings.verboseDescription(),
        get value() {
          return view.verbose ? strings.on() : strings.off();
        },
        get valueActive() {
          return view.verbose;
        },
        run: () => Effect.sync(() => view.toggleVerbose()),
      }),
      composer.command('chat', {
        name: 'stretches',
        description: strings.stretchesDescription(),
        get value() {
          return view.stretches === 'all' ? strings.on() : strings.off();
        },
        get valueActive() {
          return view.stretches === 'all';
        },
        run: () => Effect.sync(() => view.toggleStretches()),
      }),
      composer.chip('chat', { id: 'run-clock', region: 'edge', body: runClock }),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });

  provideChatRendering({
    get kinds() {
      return kinds;
    },
    get regions() {
      return rendering.regions;
    },
    get context() {
      return view;
    },
    get markdown() {
      return rendering.markdown;
    },
    get code() {
      return rendering.code;
    },
    get highlight() {
      return rendering.highlight;
    },
    get button() {
      return rendering.button;
    },
    get key() {
      return rendering.key;
    },
    get tip() {
      return rendering.tip;
    },
    get userText() {
      return rendering.userText;
    },
    get lineText() {
      return rendering.lineText;
    },
    get threadName() {
      return rendering.threadName;
    },
    get navigation() {
      return navigation;
    },
    get rewind() {
      return rendering.rewind;
    },
    opensRun: (entryId) => thread.fold.opensRun(entryId),
    get touch() {
      return rendering.touch;
    },
    loadEntry: (entryId) => void turns.run(turns.loadEntry(entryId), undefined),
    forgetTurn: (turnKey) => turns.forget(turnKey),
    resendTurn: (turnKey) => void turns.run(turns.resend(turnKey), undefined),
  });

  const contextMetrics = $derived.by(() => {
    const context = rendering.context;
    if (context === undefined) return null;
    const source = session?.contextSource ?? chatContextSource({ reading: null });
    const named = context.labels(source);
    if (named === null) return null;
    return chatContextUsageMetrics({
      source,
      providerLabel: named.provider,
      modelLabel: named.model,
      attribution: context.attribution(),
    });
  });
  const metered = $derived(contextMetrics !== null);

  $effect.pre(() => (metered ? composer.chip('chat', { id: 'context-usage', region: 'status', body: contextChip }) : undefined));

  const targets = $derived(rendering.rewind === undefined || working ? [] : rewindTargets(entries));
  const chip = $derived(rendering.rewind === undefined ? null : rewindChip(targets, (id) => rendering.rewind!.restorable(id)));

  onDestroy(() => {
    view.dispose();
    viewport.dispose();
  });

  function send(): Promise<boolean> {
    viewport.resume();
    return turns.run(turns.send(), false);
  }

  function perform(handler: ComposerHandler): void {
    void turns.run(turns.relay(settled(handler)), undefined);
  }

  function takeFiles(files: readonly File[]): void {
    perform(composer.intake(files));
  }

  function answer(questionId: string, answers: readonly ChatQuestionAnswer[]): void {
    void turns.run(turns.answerQuestion(questionId, answers), undefined);
  }

  function stop(): void {
    void turns.run(turns.stop(), undefined);
  }

  function escape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
    if (view.openedImage !== null || rendering.layered?.(event.currentTarget as Element) === true) return;
    if (dock?.dismiss()) {
      event.preventDefault();
      return;
    }
    const panel = composer.shownPanel;
    if (panel !== null) {
      if (panel.close === undefined) return;
      event.preventDefault();
      panel.close();
      return;
    }
    if (halt !== null) {
      event.preventDefault();
      if (halt === 'stop') stop();
      return;
    }
    if (dock?.escapeToRewind()) event.preventDefault();
  }
</script>

{#snippet userRow(entry: ChatEntryOf<'user'>, context: ChatEntryContext)}
  <UserMessageRow {entry} {context} textContent={rendering.userText} />
{/snippet}

{#snippet wordsRow(entry: ChatEntryOf<'words'>, context: ChatEntryContext)}
  <WordsRow {entry} {context} textContent={rendering.userText} />
{/snippet}

{#snippet assistantRow(entry: ChatEntryOf<'assistant'>, context: ChatEntryContext)}
  <AssistantMessageRow {entry} {context} />
{/snippet}

{#snippet signalEntry(entry: ChatEntryOf<'signal'>, context: ChatEntryContext)}
  {#if entry.addressee === 'transport'}
    <Well id={entry.id} text={entry.text} />
  {:else}
    <SignalRow {entry} {context} />
  {/if}
{/snippet}

{#snippet reasoningStep(entry: ChatEntryOf<'reasoning'>)}
  {@render rendering.markdown({
    cacheKey: entry.id,
    size: 'ui',
    class: 'text-muted-foreground',
    streaming: entry.reasoningState === 'streaming',
    text: entry.text,
  })}
{/snippet}

{#snippet guidanceStep(entry: ChatEntryOf<'runtime-guidance'>)}
  <Well id={entry.id} text={entry.runtimeGuidance.texts.join('\n\n')} />
{/snippet}

{#snippet readyAnswersRow(entry: ChatEntryOf<'ready-answers'>, context: ChatEntryContext)}
  <RetiredReadyAnswersRow {entry} {context} />
{/snippet}

{#snippet compactionRow(entry: ChatEntryOf<'compaction'>)}
  <CompactionRow {entry} />
{/snippet}

{#snippet runEndRow(entry: ChatEntryOf<'run-end'>)}
  <RunEndRow {entry} />
{/snippet}

{#snippet retryRow(entry: ChatEntryOf<'retry'>)}
  <RetryRow {entry} />
{/snippet}

{#snippet interruptionRow(entry: ChatEntryOf<'interruption'>)}
  <InterruptionRow {entry} />
{/snippet}

{#snippet restartRow(entry: ChatEntryOf<'restart'>)}
  <RestartRow {entry} />
{/snippet}

{#snippet unreadableRow(entry: ChatEntryOf<'unreadable'>)}
  <UnreadableRow {entry} />
{/snippet}

{#snippet errorRow(entry: ChatEntryOf<'error'>)}
  <ErrorRow {entry} />
{/snippet}

{#snippet questionRow(entry: ChatEntryOf<'question'>)}
  <QuestionRow {entry} disabled={turns.pending} onAnswer={answer} />
{/snippet}

{#snippet systemPromptRow(entry: ChatEntryOf<'system-prompt'>, context: ChatEntryContext)}
  <EntryDisclosure
    id={entry.id}
    label={strings.systemPrompt()}
    occurredAt={entry.occurredAt}
    text={entry.text}
    open={context.expanded(entry.id)}
    onToggle={() => context.setExpanded(entry.id, !context.expanded(entry.id))}
  />
{/snippet}

{#snippet contextStep(entry: ChatEntryOf<'context'>, context: ChatEntryContext)}
  <EntryDisclosure
    id={entry.id}
    label={strings.context()}
    occurredAt={entry.occurredAt}
    text={entry.text}
    open={context.expanded(entry.id)}
    onToggle={() => context.setExpanded(entry.id, !context.expanded(entry.id))}
  />
{/snippet}

{#snippet toolRow(entry: ChatEntryOf<'tool'>, context: ChatEntryContext)}
  <ToolRow {entry} {context} />
{/snippet}

{#snippet runClock()}
  {#if liveStatus !== null && liveStatus.elapsedMs !== null}
    <span
      class="flex h-4 items-center rounded-md border border-input bg-chat-field px-1.5 text-meta tabular-nums text-foreground/80"
      {@attach rendering.tip(() => ({ text: strings.runTime() }))}
    >
      {elapsedDuration(liveStatus.elapsedMs)}
    </span>
  {/if}
{/snippet}

{#snippet contextChip()}
  {#if contextMetrics !== null && rendering.context !== undefined}
    {@const metrics = contextMetrics}
    {@const detail = rendering.context.detail}
    {#snippet contextDetail()}
      {@render detail(metrics)}
    {/snippet}
    <ChatContextUsagePill {metrics} warm={rendering.context.warm()} touch={rendering.touch} detail={contextDetail} />
  {/if}
{/snippet}

{#snippet confirmationDock()}
  {#each openConfirmations as confirmation (confirmation.id)}
    {@const renderer = kinds.renderer(confirmation)}
    {#if renderer}
      {@render renderer(confirmation, view)}
    {/if}
  {/each}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="@container relative isolate flex h-full min-h-0 flex-col overflow-hidden" onkeydown={escape} {@attach intake.surface}>
  <PinnedRegion pins={rendering.regions.pins} context={view} />

  <div class="relative min-h-0 flex-1">
    <ChatTranscript
      {feed}
      {feedEpoch}
      entryCount={thread.fold.length - openConfirmations.length - (trailingReadyAnswers ? 1 : 0)}
      {trailingReadyAnswers}
      awaitingConfirmation={openConfirmations.length > 0}
      {verdict}
      {liveStatus}
      {tail}
      {now}
      {reading}
      notice={turns.notice}
      onDismissNotice={() => turns.dismiss()}
      thread={thread.threadPhase}
      emptyStateTitle={opening?.copy.title}
      emptyStateDetail={opening?.copy.detail}
      starters={opening?.copy.starters ?? []}
      {clearance}
      hasOlder={session?.hasOlder ?? false}
      loadOlder={() => turns.run(turns.loadOlder(), false)}
      {viewport}
      keyboard={navigation.keyboard}
      onDraft={(value) => turns.draft.setText(value)}
      onSend={send}
    />
  </div>

  <ChatComposerOverlay
    {viewport}
    {feed}
    clockOffset={session?.clockOffset ?? 0}
    {tail}
    still={reading.kind !== 'live'}
    onClearance={(height) => (clearance = height)}
  >
    <ComposerDock
      bind:this={dock}
      contributions={composer}
      {handle}
      canSend={turns.canSend}
      {draft}
      queued={session?.queued ?? []}
      steers={session?.pendingSteers ?? []}
      steerable={session?.readsMidRun ?? true}
      wordsWait={session?.wordsWait ?? null}
      unqueueingId={turns.waiting.busy}
      placeholder={strings.promptPlaceholder()}
      running={alive}
      {halt}
      sending={turns.pending}
      confirmation={confirmationDock}
      onUnqueue={(id) => void turns.run(turns.waiting.unqueue(id), undefined)}
      onEdit={(id) => void turns.run(turns.waiting.edit(id), undefined)}
      onPromote={(id) => void turns.run(turns.waiting.promote(id), undefined)}
      onDraft={(value) => turns.draft.setText(value)}
      onSend={send}
      onStop={stop}
      onQueue={() => turns.run(turns.queueDraft(), false)}
      {perform}
      history={turns.history}
      rewindTargets={targets}
      rewindChip={chip}
    />
  </ChatComposerOverlay>

  {#if intake.dragging}
    <div class="absolute inset-0 z-[140] p-3" {@attach intake.overlay}>
      <div
        class="pointer-events-none grid h-full place-items-center rounded-lg border-2 border-dashed border-primary/60 bg-background/85 backdrop-blur-sm"
      >
        <span class="flex items-center gap-2 text-ui font-medium text-foreground">
          <Paperclip class="size-4" />
          {strings.attachFiles()}
        </span>
      </div>
    </div>
  {/if}

  <ImageViewer image={view.openedImage} onClose={() => view.closeImage()} />
</div>
