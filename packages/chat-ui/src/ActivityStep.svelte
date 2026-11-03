<script lang="ts">
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { referencedThreads } from '@runlith/agent/tool/display';
  import { KEEP_WARM_SIGNAL_TYPE } from '@runlith/agent/transcript/keepWarm';
  import { slide } from 'svelte/transition';
  import {
    type ActivityEntry,
    type ActivityRow,
    CALL_CLOCK_MIN_MS,
    chatCompactionFacts,
    chatKeepWarmFacts,
    type ChatStepFact,
    type ChatStepLine,
    chatStepLine,
    chatStepMark,
    type ChatStepMoment,
    chatThoughtLabel,
    chatToolActivity,
    displayDraws,
    firstLabelLine,
    foldedSubjects,
    foldedToolCounts,
    messagePreview,
    type RailPlace,
    readableOutput,
    shownFacts,
    type ToolActivityEntry,
    toolCancelled,
    toolFailed,
    toolOperationRefused,
    toolInterrupted,
    toolOpensByDefault,
    toolOutcomeUnknown,
    toolQueued,
    toolRefusalWord,
    toolSettled,
    toolStartedAt,
  } from './activity';
  import { callDuration, elapsedDuration } from './chatTime';
  import { clipFade } from './clipFade';
  import ClampedText from './entries/ClampedText.svelte';
  import CopyAddress from './entries/CopyAddress.svelte';
  import Notices from './entries/Notices.svelte';
  import ThreadChip from './entries/ThreadChip.svelte';
  import ToolXRay from './entries/ToolXRay.svelte';
  import Rail from './Rail.svelte';
  import RailRow from './RailRow.svelte';
  import { type ChatActivityIdentity, type ChatToolStatus, type ChatToolStatusHold, chatToolStanding, useChatRendering } from './renderers';
  import { useChatStrings } from './strings';
  import type { ChatLiveStatus } from './liveStatus';
  import PhaseClock from './PhaseClock.svelte';

  type Props = {
    row: ActivityRow;
    stretch?: string;
    newest?: boolean;
    bare?: boolean;
    place?: RailPlace;
    now?: number;
    live?: boolean;
    clock?: ChatLiveStatus | null;
    phaseClock?: boolean;
    still?: boolean;
  };

  type Thread = ChatActivityIdentity['threads'][number];

  let {
    row,
    stretch = '',
    newest = false,
    bare = false,
    place = 'only',
    now = Date.now(),
    live = false,
    clock = null,
    phaseClock = false,
    still = false,
  }: Props = $props();
  const strings = useChatStrings();
  const rendering = useChatRendering();
  const context = $derived(rendering.context);

  const expandDuration = 160;
  const CHIPS_SHOWN = 3;

  function refused(entry: ActivityEntry): boolean {
    return entry.kind === 'tool' && toolOperationRefused(entry);
  }

  function stateUnknown(entry: ToolActivityEntry): boolean {
    return still && !toolSettled(entry);
  }

  const moment: ChatStepMoment = $derived({ still, live, clock });

  function stepLine(entry: ActivityEntry, identity: ChatActivityIdentity | undefined, plain = false): ChatStepLine {
    const standing = entry.kind === 'tool' && rendering.kinds.toolStatus(entry)?.standing?.(entry) === true;
    return chatStepLine(entry, identity, standing ? { ...moment, standing } : moment, strings, plain);
  }

  function foldedLabels(entries: readonly ToolActivityEntry[]): readonly string[] {
    return foldedToolCounts(entries).map(({ name, count }) => (count === 1 ? strings.toolDone(name) : strings.toolDoneCount(name, count)));
  }

  function foldedDetail(entries: readonly ToolActivityEntry[]): string | null {
    const subjects = foldedSubjects(
      entries.map((entry) => ({
        ...entry,
        display: entry.display
          ? { ...entry.display, title: chatToolActivity(entry, rendering.kinds.identity(entry), still).title ?? undefined }
          : undefined,
      })),
    );
    return subjects.length === 0 ? null : subjects.join(', ');
  }

  function failureTold(entry: ToolActivityEntry, hold: ChatToolStatusHold | null): boolean {
    return hold === null && shownFacts(entry.display?.facts ?? [], context.verbose).length > 0;
  }

  function toolTrouble(entry: ToolActivityEntry): boolean {
    return Boolean(entry.toolError) || toolOperationRefused(entry) || toolOutcomeUnknown(entry) || toolInterrupted(entry);
  }

  function toolBody(entry: ToolActivityEntry): boolean {
    const display = entry.display;
    if (entry.toolError || entry.toolRefusal || entry.toolInputRaw) return true;
    if ((display?.images?.length ?? 0) > 0) return true;
    if (displayDraws(display)) return true;
    if (rendering.kinds.toolRenders(entry)) return true;
    return readableOutput(entry, (name, output) => rendering.kinds.toolModelText(name, output)) !== null;
  }

  function stepExpandable(entry: ActivityEntry): boolean {
    if (entry.kind === 'reasoning') return entry.text.trim().length > 0 && chatThoughtLabel(entry.text) === null;
    if (entry.kind === 'signal') return entry.text.trim().length > 0;
    if (entry.kind === 'runtime-guidance') return entry.runtimeGuidance.texts.some((text) => text.trim().length > 0);
    if (entry.kind === 'compaction' || entry.kind === 'retry') return false;
    if (toolBody(entry)) return true;
    if (!context.verbose && !toolTrouble(entry)) return false;
    return entry.toolInput !== undefined || entry.toolOutput !== undefined || (entry.display?.details?.length ?? 0) > 0;
  }

  function threadReferences(entry: ActivityEntry, identity: ChatActivityIdentity | undefined): ChatActivityIdentity['threads'] {
    if (identity) return identity.threads;
    if (entry.kind !== 'tool') return [];
    const reference = entry.display?.reference;
    return referencedThreads(reference).map((thread) => ({
      id: thread.threadId,
      title: reference?.kind === 'agents' ? (thread.name ?? thread.threadId) : (entry.display?.title ?? strings.openThread()),
      ...(thread.projectId === undefined ? {} : { projectId: thread.projectId }),
    }));
  }

  function chipsOf(entry: ActivityEntry, threads: readonly Thread[], subject: string | null): readonly Thread[] {
    if (threads.length === 0) return [];
    if (entry.kind === 'signal') return threads.length === 1 ? threads : [];
    if (entry.kind !== 'tool') return [];
    const reference = entry.display?.reference;
    if (reference?.kind === 'agents') return threads.length === reference.recipients.length ? threads : [];
    if (reference?.kind === 'agent' || reference?.kind === 'thread') return threads.length === 1 ? threads : [];
    return threads.length === 1 && subject === threads[0]?.title ? threads : [];
  }

  function toolFile(entry: ActivityEntry): { readonly path: string; readonly line: number | undefined } | null {
    if (entry.kind !== 'tool') return null;
    const display = entry.display;
    if (display?.form === 'diff') return display.files.length === 1 ? { path: display.files[0].path, line: undefined } : null;
    if (display?.form === 'code' && display.path !== undefined) return { path: display.path, line: display.firstLine };
    if (display?.form === 'binary') return { path: display.path, line: undefined };
    return null;
  }

  function opensByDefault(entry: ActivityEntry): boolean {
    return entry.kind === 'tool' && toolOpensByDefault(entry, rendering.kinds.toolOpen(entry.toolName));
  }

  function stepOpen(entry: ActivityEntry): boolean {
    return context.expanded(entry.id, context.stretchDefault(stretch, newest) ? opensByDefault(entry) : false);
  }

  function dotClass(entry: ActivityEntry): string {
    return chatStepMark(entry, rendering.kinds, moment);
  }

  function tone(entry: ActivityEntry): string {
    if (entry.kind === 'tool') {
      if (toolFailed(entry)) return 'text-chat-failure/90';
      if (refused(entry)) return 'text-chat-refused/90';
      if (toolQueued(entry)) return 'text-muted-foreground/60 group-hover/step:text-muted-foreground';
      return 'text-muted-foreground group-hover/step:text-foreground';
    }
    return 'text-muted-foreground/60';
  }

  function preview(entry: ActivityEntry, open: boolean): string | null {
    if (open) return null;
    if (entry.kind === 'tool') return messagePreview(entry);
    if (entry.kind === 'signal' && entry.signalType !== KEEP_WARM_SIGNAL_TYPE) return firstLabelLine(entry.text) || null;
    return null;
  }

  function retryFacts(entry: Extract<ActivityEntry, { kind: 'retry' }>): readonly ChatStepFact[] {
    return [{ label: strings.retryReason(entry.family) }, { label: `${entry.attempt}/${entry.of}`, quiet: true }];
  }

  function toggleStep(id: string, current: boolean): void {
    context.setExpanded(id, !current);
  }

  function openStep(entry: ActivityEntry, current: boolean): void {
    toggleStep(entry.id, current);
    if (!current && entry.kind === 'tool' && entry.truncated !== undefined) rendering.loadEntry(entry.id);
  }

  function keyStep(event: KeyboardEvent, entry: ActivityEntry, current: boolean): void {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openStep(entry, current);
  }
</script>

<div class="mr-auto w-full min-w-0 max-w-feed">
  {#if row.kind === 'thoughts'}
    {@const thoughtsOpen = context.expanded(row.key)}
    <RailRow {place}>
      {@render countedLine([strings.thoughtsCount(row.entries.length)], null, thoughtsOpen, row.key, true)}
      {#if thoughtsOpen}
        <div class="mt-1" transition:slide={{ duration: expandDuration }}>
          <Rail count={row.entries.length}>
            {#snippet children(at)}
              {#each row.entries as entry, index (entry.id)}
                <RailRow place={at(index)}>
                  {@render plainLine(stepLine(entry, rendering.kinds.identity(entry), true))}
                </RailRow>
              {/each}
            {/snippet}
          </Rail>
        </div>
      {/if}
    </RailRow>
  {:else if row.kind === 'folded'}
    {@const foldOpen = context.expanded(row.key)}
    <RailRow {place} dot="bg-muted-foreground/40">
      {@render countedLine(foldedLabels(row.entries), foldedDetail(row.entries), foldOpen, row.key, false)}
      {#if foldOpen}
        <div class="mt-1" transition:slide={{ duration: expandDuration }}>
          <Rail count={row.entries.length}>
            {#snippet children(at)}
              {#each row.entries as entry, index (entry.id)}
                <RailRow place={at(index)} dot={dotClass(entry)}>{@render step(entry)}</RailRow>
              {/each}
            {/snippet}
          </Rail>
        </div>
      {/if}
    </RailRow>
  {:else if row.kind === 'notices'}
    <RailRow {place} dot="bg-muted-foreground/25"><Notices key={row.key} entries={row.entries} /></RailRow>
  {:else if bare}
    <RailRow {place}>
      {@render plainLine(stepLine(row.entry, rendering.kinds.identity(row.entry), true))}
    </RailRow>
  {:else}
    <RailRow {place} dot={dotClass(row.entry)}>{@render step(row.entry)}</RailRow>
  {/if}
</div>

{#snippet countedLine(labels: readonly string[], detail: string | null, open: boolean, key: string, quiet: boolean)}
  <button
    type="button"
    class={[
      'flex w-full cursor-pointer items-baseline gap-1.5 text-left text-ui whitespace-nowrap transition hover:text-foreground',
      quiet ? 'text-muted-foreground/60' : 'text-muted-foreground',
    ]}
    aria-expanded={open}
    onclick={() => toggleStep(key, open)}
  >
    <span class="flex shrink-0 gap-x-3">
      {#each labels as label, index (index)}<span>{label}</span>{/each}
    </span>
    {#if detail}<span class="min-w-0 text-muted-foreground/55" data-fade {@attach clipFade}>— {detail}</span>{/if}
    <ChevronRight class={`size-3 shrink-0 translate-y-0.5 text-muted-foreground/40 transition-transform ${open ? 'rotate-90' : ''}`} />
  </button>
{/snippet}

{#snippet plainLine(line: ChatStepLine)}
  <div class="flex items-baseline gap-2 text-ui">
    <span class="min-w-0 text-muted-foreground/60" data-fade {@attach clipFade}
      >{line.lead}{#if line.subject}<span class={line.join === 'apart' ? 'ml-1.5 text-muted-foreground/45' : ''}
          >{line.join === 'apart' || line.lead === null ? '' : ' '}{line.subject}</span
        >{/if}{#if line.detail}{` ${line.detail}`}{/if}</span
    >
  </div>
{/snippet}

{#snippet step(entry: ActivityEntry)}
  {@const isOpen = stepOpen(entry)}
  {@const identity = rendering.kinds.identity(entry)}
  {@const line = stepLine(entry, identity)}
  {@const threads = threadReferences(entry, identity)}
  {@const chips = chipsOf(entry, threads, line.subject)}
  {@const toolActions = entry.kind === 'tool' ? rendering.kinds.toolActions(entry) : undefined}
  {@const status = entry.kind === 'tool' ? rendering.kinds.toolStatus(entry) : undefined}
  {@const hold = entry.kind === 'tool' ? (status?.held(entry) ?? null) : null}
  {@const expandable = stepExpandable(entry)}
  {@const stepFile = rendering.navigation.files ? toolFile(entry) : null}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex w-full min-w-0 items-baseline gap-x-1.5"
    oncontextmenu={stepFile === null
      ? undefined
      : (event) => {
          event.preventDefault();
          rendering.navigation.linkMenu(
            { kind: 'file', path: stepFile.path, line: stepFile.line ?? undefined },
            { x: event.clientX, y: event.clientY },
          );
        }}
  >
    {#if expandable}
      <div
        role="button"
        tabindex="0"
        class="group/step flex min-w-0 flex-1 cursor-pointer items-baseline gap-x-1.5 overflow-hidden text-left text-ui whitespace-nowrap"
        aria-expanded={isOpen}
        data-entry={entry.id}
        onclick={() => openStep(entry, isOpen)}
        onkeydown={(event) => keyStep(event, entry, isOpen)}
      >
        {@render stepText(entry, line, chips, status, hold, isOpen)}
      </div>
    {:else}
      <div class="group/step flex min-w-0 flex-1 items-baseline gap-x-1.5 overflow-hidden text-ui whitespace-nowrap">
        {@render stepText(entry, line, chips, status, hold, isOpen)}
      </div>
    {/if}
    {#if entry.kind === 'tool' && toolActions}
      <span class="-my-1 flex shrink-0 items-center self-center">
        {@render toolActions(entry)}
      </span>
    {/if}
    {#if stepFile !== null}
      <button
        type="button"
        class="inline-flex shrink-0 cursor-pointer items-center text-muted-foreground/40 transition hover:text-muted-foreground"
        aria-label={strings.openFile(stepFile.path)}
        {@attach rendering.navigation.link({ kind: 'file', path: stepFile.path, line: stepFile.line ?? undefined })}
        data-open-path={stepFile.path}
      >
        <ArrowUpRight class="size-3.5" />
      </button>
    {/if}
    {#if chips.length === 0}
      {#each threads as thread (thread.id)}
        <button
          type="button"
          class="inline-flex shrink-0 cursor-pointer items-center text-muted-foreground/40 transition hover:text-muted-foreground"
          aria-label={`${strings.openThread()}: ${thread.title}`}
          {@attach rendering.navigation.link({ kind: 'thread', threadId: thread.id, projectId: thread.projectId })}
        >
          <ArrowUpRight class="size-3.5" />
        </button>
      {/each}
    {/if}
  </div>
  {#if isOpen && expandable}
    <div transition:slide={{ duration: expandDuration }}>{@render stepDetail(entry)}</div>
  {/if}
{/snippet}

{#snippet inline(text: string)}{#if rendering.lineText}{@render rendering.lineText(text)}{:else}{text}{/if}{/snippet}

{#snippet linked(text: string)}{#if rendering.userText}{@render rendering.userText(text)}{:else}{text}{/if}{/snippet}

{#snippet stepText(
  entry: ActivityEntry,
  line: ChatStepLine,
  chips: readonly Thread[],
  status: ChatToolStatus | undefined,
  hold: ChatToolStatusHold | null,
  open: boolean,
)}
  {@const said = preview(entry, open)}
  {@const named = chips.length === 0 ? line.subject : null}
  {#if hold === 'marked' && entry.kind === 'tool' && status}
    {@render status.mark(entry)}
    <span class={['min-w-0', tone(entry)]} data-fade {@attach clipFade}>{line.subject ?? line.lead}</span>
  {:else}
    {@const toolName = context.verbose && entry.kind === 'tool' ? entry.toolName : null}
    {#if line.lead !== null}
      <span class={['shrink-0', tone(entry)]} {@attach toolName === null ? undefined : rendering.tip(() => ({ text: toolName }))}
        >{line.lead}</span
      >
    {/if}
    {#each chips.slice(0, CHIPS_SHOWN) as thread (thread.id)}
      <ThreadChip {thread} />
    {/each}
    {#if chips.length > CHIPS_SHOWN}
      <span class="shrink-0 text-small text-muted-foreground/60">+{chips.length - CHIPS_SHOWN}</span>
    {/if}
    {#if named || line.detail || said}
      <span class={['min-w-0', chips.length > 0 && 'max-w-max flex-1']} data-fade {@attach clipFade}
        >{#if named}<span class={line.join === 'apart' ? 'ml-1.5 text-muted-foreground/45' : tone(entry)}>{@render inline(named)}</span
          >{/if}{#if line.detail}<span class="text-muted-foreground/70">{named ? ' ' : ''}{@render inline(line.detail)}</span
          >{/if}{#if said}<span class="text-muted-foreground/55">{line.detail ? ' — ' : named ? ' ' : ''}{@render inline(said)}</span
          >{/if}</span
      >
    {/if}
  {/if}
  {#if entry.kind === 'signal'}
    {#if entry.signalType === KEEP_WARM_SIGNAL_TYPE}
      {@render facts([...chatKeepWarmFacts(entry, strings), ...rendering.kinds.facts(entry)])}
    {/if}
  {:else if entry.kind === 'tool'}
    {#if entry.display?.form === 'binary'}
      <span class="ml-1.5 shrink-0 font-mono text-meta text-muted-foreground/60">{entry.display.byteLength} B</span>
      <span class="ml-1.5 shrink-0 font-mono text-meta text-muted-foreground/60">binary</span>
    {/if}
    {#if entry.display?.form === 'diff'}
      {@render changes(
        entry.display.files.reduce((total, file) => total + file.added, 0),
        entry.display.files.reduce((total, file) => total + file.removed, 0),
      )}
    {/if}
    {#if hold !== null && status}
      {@render status.status(entry)}
    {:else}
      {@render facts(entry.display?.facts ?? [])}
      {@const took = entry.display?.durationMs}
      {#if took !== undefined && !chatToolStanding(entry) && (context.verbose || took >= CALL_CLOCK_MIN_MS)}
        <span class="ml-1.5 shrink-0 font-mono text-meta tabular-nums text-muted-foreground/90">{callDuration(took)}</span>
      {/if}
    {/if}
    {@const startedAt = toolStartedAt(entry)}
    {#if stateUnknown(entry)}
      {#if hold === null}<span class="ml-1.5 shrink-0 text-small text-muted-foreground/60">{strings.stateUnknown()}</span>{/if}
    {:else if toolQueued(entry)}
      <span class="ml-1.5 shrink-0 text-small text-muted-foreground/60">{strings.queued()}</span>
      {#if entry.execution?.state === 'queued' && entry.execution.reason}
        <span class="min-w-0 shrink-[1000] text-small text-muted-foreground/50" data-fade {@attach clipFade}
          >— {entry.execution.reason}</span
        >
      {/if}
    {:else if startedAt !== null && hold === null}
      <span class="ml-1.5 shrink-0 font-mono text-small tabular-nums text-muted-foreground/70"
        >{elapsedDuration(Math.max(0, now - startedAt))}</span
      >
    {/if}
    {#if toolOutcomeUnknown(entry)}
      <span class="ml-1.5 shrink-0 text-small text-muted-foreground/60">{strings.outcomeUnknown()}</span>
    {:else if toolCancelled(entry)}
      <span class="ml-1.5 shrink-0 text-small text-muted-foreground/60">{strings.cancelled()}</span>
    {:else if toolInterrupted(entry)}
      <span class="ml-1.5 shrink-0 text-small text-muted-foreground/60">{strings.interrupted()}</span>
    {:else if refused(entry)}
      {@const word = toolRefusalWord(entry, strings.refused())}
      {#if word !== null}<span class="ml-1.5 shrink-0 text-small text-chat-refused/90">{word}</span>{/if}
    {:else if toolFailed(entry) && !failureTold(entry, hold)}
      <span class="ml-1.5 shrink-0 text-small text-chat-failure/90">{strings.failed()}</span>
    {/if}
  {:else if entry.kind === 'compaction'}
    {@render facts([...chatCompactionFacts(entry, strings), ...rendering.kinds.facts(entry)])}
  {:else if entry.kind === 'retry'}
    {@render facts(retryFacts(entry))}
  {/if}
  {#if live && phaseClock && clock && entry.kind !== 'tool' && entry.kind !== 'retry'}<PhaseClock status={clock} />{/if}
{/snippet}

{#snippet changes(added: number, removed: number)}
  <span class="shrink-0 font-mono text-meta">
    {#if added > 0}<span class="text-chat-diff-added">+{added}</span>{/if}{#if added > 0 && removed > 0}
      <span class="text-muted-foreground/40"> </span>
    {/if}{#if removed > 0}<span class="text-chat-diff-removed">−{removed}</span>{/if}
  </span>
{/snippet}

{#snippet facts(list: readonly ChatStepFact[])}
  {#each shownFacts(list, context.verbose) as fact, index (index)}
    {#if fact.value === undefined}
      <span class="ml-1.5 shrink-0 font-mono text-meta text-muted-foreground/60">{fact.label}</span>
    {:else}
      <span class="ml-1.5 min-w-0 shrink-[1000] font-mono text-meta text-muted-foreground/60" data-fade {@attach clipFade}
        >{fact.label}&nbsp;<span class="text-muted-foreground/90">{fact.value}</span></span
      >
    {/if}
  {/each}
{/snippet}

{#snippet stepDetail(entry: ActivityEntry)}
  {@const address = rendering.navigation.entryAddress(entry.id)}
  <div class="mt-1.5 mb-1 grid grid-cols-1 gap-2">
    {#if entry.kind !== 'tool'}
      {@const renderer = rendering.kinds.renderer(entry)}
      {#if renderer}
        {@render renderer(entry, rendering.context)}
      {/if}
      {#if address && context.verbose}
        <div class="flex items-center gap-1.5 font-mono text-meta text-muted-foreground/50">
          <span class="min-w-0" data-fade {@attach clipFade}>{entry.id}</span>
          <CopyAddress {address} {context} id={entry.id} />
        </div>
      {/if}
    {:else}
      {#if entry.toolError && !failureTold(entry, rendering.kinds.toolStatus(entry)?.held(entry) ?? null)}
        <ClampedText text={entry.toolError} id={`${entry.id}:error`} />
      {/if}
      {#if entry.toolRefusal && !rendering.kinds.toolRenders(entry)}
        <p class="text-ui leading-snug break-words whitespace-pre-wrap text-muted-foreground">{@render linked(entry.toolRefusal.reason)}</p>
      {/if}
      {@const toolRenderer = rendering.kinds.renderer(entry)}
      {#if toolRenderer}
        {@render toolRenderer(entry, rendering.context)}
      {/if}
      {@const targetDetail = rendering.kinds.toolStatus(entry)?.detail(entry) ?? null}
      {#if targetDetail}
        {@render targetDetail(entry)}
      {/if}
      {@const details = context.verbose ? (entry.display?.details ?? []) : []}
      {@const launch = context.verbose && chatToolStanding(entry) ? entry.display?.durationMs : undefined}
      {@const ordered =
        context.verbose && entry.execution?.state === 'started' && (entry.execution.waitedMs ?? 0) > 0 ? entry.execution : null}
      {@const factsShown = details.length > 0 || launch !== undefined || ordered !== null}
      {#if factsShown}
        <dl class="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 font-mono text-meta text-muted-foreground/50">
          {#each details as detail, index (index)}
            <dt>{detail.label}</dt>
            <dd class="flex min-w-0 items-center gap-1.5">
              {#if detail.value !== undefined}
                <span class="min-w-0 text-muted-foreground/80" title={detail.value} data-fade {@attach clipFade}>{detail.value}</span>
                <CopyAddress address={detail.value} {context} id={`${entry.id}:detail:${index}`} />
              {/if}
            </dd>
          {/each}
          {#if launch !== undefined}
            <dt>{strings.launchTime()}</dt>
            <dd class="text-muted-foreground/80">{callDuration(launch)}</dd>
          {/if}
          {#if ordered !== null}
            <dt>{strings.waited()}</dt>
            <dd class="min-w-0 text-muted-foreground/80" data-fade {@attach clipFade}>
              {strings.waitedAfter(callDuration(ordered.waitedMs ?? 0), (ordered.after ?? []).map((call) => call.toolName).join(', '))}
            </dd>
          {/if}
        </dl>
      {/if}
      {#if context.verbose || toolTrouble(entry)}
        {@const modelText = rendering.kinds.toolModelText(entry.toolName, entry.toolOutput)}
        <ToolXRay {entry} {context} {address} {modelText} folded={toolBody(entry) || targetDetail !== null || factsShown} />
      {/if}
    {/if}
  </div>
{/snippet}
