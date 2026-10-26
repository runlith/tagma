<script lang="ts">
  import type { Snippet } from 'svelte';
  import { clipFade } from './clipFade';
  import type { ChatContextUsageMetrics } from './contextUsage';
  import ContextRing, { CONTEXT_RING_HOT } from './ContextRing.svelte';
  import { CHAT_CONTEXT_SEGMENT_STEPS, chatContextUsageDetailRows, formatContextPercent, formatContextTokens } from './contextUsage';
  import { useChatStrings } from './strings';

  type Props = {
    metrics: ChatContextUsageMetrics;
    warm?: boolean;
    touch?: boolean;
    detail?: Snippet;
  };

  let { metrics, warm = false, touch = false, detail }: Props = $props();
  const strings = useChatStrings();

  const unknown = $derived(metrics.reading === 'unknown');
  const percentUsed = $derived(unknown ? undefined : metrics.usagePercent);
  const rawPercent = $derived(
    !unknown && metrics.limitTokens !== undefined ? (metrics.contextTokens / metrics.limitTokens) * 100 : undefined,
  );
  const compaction = $derived(metrics.limit?.compaction ?? null);
  const compactsAt = $derived(
    compaction === null || metrics.limit === undefined
      ? undefined
      : strings.contextCompactsAt(
          formatContextPercent((compaction.at / metrics.limit.window) * 100, strings.locale),
          formatContextTokens(metrics.limit.window, strings.locale),
        ),
  );
  const usedLabel = $derived(
    percentUsed === undefined
      ? undefined
      : percentUsed === 0 && (rawPercent ?? 0) > 0
        ? strings.lessThanOnePercent()
        : formatContextPercent(percentUsed, strings.locale),
  );
  const share = $derived((rawPercent ?? 0) / 100);
  const figured = $derived(usedLabel !== undefined);
  const segments = $derived.by(() => {
    const slices = metrics.segments ?? [];
    const basis = slices.reduce((total, slice) => total + slice.tokens, 0);
    if (basis <= 0) return [];
    return slices.map((slice, index) => ({
      label: slice.label,
      tokens: slice.tokens,
      width: (slice.tokens / basis) * 100,
      step: CHAT_CONTEXT_SEGMENT_STEPS[index % CHAT_CONTEXT_SEGMENT_STEPS.length],
    }));
  });

  const usageRows = $derived(
    chatContextUsageDetailRows(metrics, strings.locale, {
      input: strings.contextInput(),
      output: strings.contextOutput(),
      reasoning: strings.contextReasoning(),
      cacheRead: strings.contextCacheRead(),
      cacheWrite: strings.contextCacheWrite(),
      total: strings.contextTotal(),
    }),
  );

  let hovered = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function openTip(): void {
    if (touch) return;
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    hovered = true;
  }

  function scheduleClose(): void {
    if (touch) return;
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      hovered = false;
      closeTimer = undefined;
    }, 150);
  }
</script>

<div class="relative" role="group" onmouseenter={openTip} onmouseleave={scheduleClose}>
  <button
    aria-label={strings.contextUsage()}
    class={[
      'flex h-7 items-center gap-1.5 rounded-full text-meta tabular-nums text-muted-foreground transition hover:bg-hover',
      figured ? 'px-2' : 'w-7 justify-center',
    ]}
    type="button"
    aria-expanded={hovered}
    onclick={() => {
      if (touch) hovered = !hovered;
    }}
  >
    {#if unknown}
      <span class="grid size-3.5 place-items-center rounded-full border border-dashed border-muted-foreground text-meta" aria-hidden="true"
        >?</span
      >
    {:else}
      <ContextRing {share} {warm} label={usedLabel ?? formatContextTokens(metrics.contextTokens, strings.locale)} />
      {#if figured}<span class={share >= CONTEXT_RING_HOT ? 'text-destructive' : undefined}>{usedLabel}</span>{/if}
    {/if}
  </button>

  {#if hovered && touch}
    <button
      type="button"
      class="fixed inset-0 z-[129] cursor-default bg-background/50"
      aria-label={strings.close()}
      onclick={() => (hovered = false)}
    ></button>
  {/if}
  {#if hovered}
    <div
      role={touch ? 'dialog' : 'tooltip'}
      class={touch
        ? 'pointer-events-auto fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-[130] grid max-h-[85dvh] grid-cols-1 gap-2 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-4 text-left text-popover-foreground shadow-float'
        : `pointer-events-auto absolute bottom-[calc(100%+0.5rem)] right-0 z-[130] grid max-h-[min(44rem,calc(100dvh-8rem))] grid-cols-1 gap-2 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-3 text-left text-popover-foreground shadow-raised ${
            detail ? 'w-[min(24rem,calc(100vw-2rem))]' : 'w-52'
          }`}
      onmouseenter={openTip}
      onmouseleave={scheduleClose}
    >
      <div class="grid grid-cols-1 gap-0.5 text-small text-muted-foreground" data-context-summary>
        <div class="flex min-w-0 items-baseline gap-2">
          {#if unknown}
            <span class="text-page font-semibold">—</span>
          {:else if usedLabel}
            <span class={['text-page font-semibold tabular-nums', share >= CONTEXT_RING_HOT ? 'text-destructive' : 'text-foreground']}
              >{usedLabel}</span
            >
            <span class="text-ui">{strings.contextUsed()}</span>
          {:else}
            <span class="text-page font-semibold tabular-nums text-foreground"
              >{formatContextTokens(metrics.contextTokens, strings.locale)}</span
            >
            <span class="text-ui">{strings.tokens()}</span>
          {/if}
          {#if usedLabel && metrics.limitTokens !== undefined}
            <span class="ml-auto shrink-0 font-mono tabular-nums">
              {strings.contextTokensUsed(
                formatContextTokens(metrics.contextTokens, strings.locale),
                formatContextTokens(metrics.limitTokens, strings.locale),
              )}
            </span>
          {/if}
        </div>
        {#if unknown}
          <span data-fade {@attach clipFade}>{strings.contextStaleSince(formatContextTokens(metrics.contextTokens, strings.locale))}</span>
        {:else if !usedLabel}
          <span data-fade {@attach clipFade}>{strings.contextWindowUnknown()}</span>
        {/if}
        {#if !unknown && metrics.reading === 'estimated'}
          <span data-fade {@attach clipFade}>{strings.contextEstimated()}</span>
        {/if}
        {#if metrics.nextRequestTokens !== undefined}
          <span data-fade {@attach clipFade}
            >{strings.contextNextRequest(formatContextTokens(metrics.nextRequestTokens, strings.locale))}</span
          >
        {/if}
      </div>
      {#if !detail && compactsAt !== undefined}
        <div class="text-small text-muted-foreground" data-fade {@attach clipFade}>{compactsAt}</div>
      {/if}
      {#if detail}
        {@render detail()}
      {:else if segments.length > 0}
        <div class="grid gap-1.5 border-t border-border pt-2">
          <div class="flex h-1.5 w-full gap-px">
            {#each segments as segment (segment.label)}
              <div class={segment.step} style={`width: ${segment.width}%`}></div>
            {/each}
          </div>
          <div class="grid gap-1 text-small">
            {#each segments as segment (segment.label)}
              <div class="flex items-center justify-between gap-3">
                <span class="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span class={['size-1.5 shrink-0', segment.step]}></span>
                  <span class="min-w-0" data-fade {@attach clipFade}>{segment.label}</span>
                </span>
                <span class="font-medium tabular-nums text-foreground">{formatContextTokens(segment.tokens, strings.locale)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
      {#if usageRows.length > 0 && !detail}
        <div class="grid gap-1 border-t border-border pt-2 text-small">
          {#each usageRows as row}
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">{row.label}</span>
              <span class="font-medium tabular-nums text-foreground">{row.value}</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if metrics.modelLabel && !detail}
        <div class="border-t border-border pt-2 text-small text-muted-foreground" data-fade {@attach clipFade}>
          {metrics.modelLabel}
        </div>
      {/if}
    </div>
  {/if}
</div>
