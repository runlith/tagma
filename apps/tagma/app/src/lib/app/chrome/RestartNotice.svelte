<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Restart } from '$lib/wire/Restart.svelte.js';

  type Tone = 'work' | 'quiet' | 'back' | 'bad';
  type Reading = {
    readonly tone: Tone;
    readonly title: string;
    readonly line: string;
    readonly progress: number | null;
    readonly details: readonly string[];
    readonly dismiss: boolean;
  };

  let { silence = true }: { silence?: boolean } = $props();

  const restart = Restart.use();

  let now = $state(Date.now());
  $effect(() => {
    if (restart.since === null) return;
    now = Date.now();
    const tick = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(tick);
  });

  let open = $state(false);

  const elapsed = $derived.by(() => {
    if (restart.since === null) return '';
    const seconds = Math.max(0, Math.round((now - restart.since) / 1000));
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`;
  });

  const reading = $derived.by((): Reading | null => {
    const startup = restart.startup;
    if (restart.since === null) {
      if (restart.stayed === null) return null;
      return {
        tone: 'quiet',
        title: 'Tagma did not restart',
        line: 'it keeps running as it was',
        progress: null,
        details: [restart.stayed],
        dismiss: true,
      };
    }
    if (startup?.status === 'failed') {
      const failure = startup.failure;
      return {
        tone: 'bad',
        title: 'Tagma did not start',
        line: 'it stopped while starting',
        progress: null,
        details: failure === null ? [] : [`${failure.phase} — ${failure.detail}`],
        dismiss: false,
      };
    }
    if (restart.returning) {
      return { tone: 'back', title: 'Tagma is back', line: 'opening where you were', progress: null, details: [], dismiss: false };
    }
    if (!restart.announced) {
      if (!silence) return null;
      return { tone: 'quiet', title: 'Tagma is not answering', line: 'reconnecting', progress: null, details: [], dismiss: false };
    }
    const step = startup?.status === 'starting' ? startup.step : null;
    const line =
      step !== null
        ? `updating your data, ${step.index} of ${step.total}`
        : restart.heavy !== null
          ? 'large update, this can take a few minutes'
          : 'back in a few seconds';
    return {
      tone: 'work',
      title: 'Tagma is restarting',
      line,
      progress: step === null || step.total === 0 ? null : Math.min(1, step.index / step.total),
      details: [],
      dismiss: false,
    };
  });

  $effect(() => {
    if (reading?.details.length === 0) open = false;
  });

  const STRIP: Record<Tone, string> = {
    work: 'border-status-in-work/25 bg-status-in-work/10',
    quiet: 'bg-raised',
    back: 'border-status-done/25 bg-status-done/10',
    bad: 'border-destructive/25 bg-destructive/10',
  };
  const TITLE: Record<Tone, string> = {
    work: 'text-status-in-work',
    quiet: 'text-foreground',
    back: 'text-status-done',
    bad: 'text-destructive',
  };
</script>

{#if reading !== null}
  <div class={['shrink-0 border-b', STRIP[reading.tone]]} role="status" aria-live="polite" data-restart-notice={reading.tone}>
    <div class="flex h-7 items-center gap-2 px-4 text-small">
      {#if reading.tone === 'bad'}
        <TriangleAlert class="size-3.5 shrink-0 text-destructive" />
      {:else if reading.tone === 'back'}
        <Check class="size-3.5 shrink-0 text-status-done" />
      {:else if restart.since === null}
        <TriangleAlert class="size-3.5 shrink-0 text-muted-foreground" />
      {:else}
        <Waiting class={['size-3.5', reading.tone === 'work' ? 'text-status-in-work' : 'text-muted-foreground']} />
      {/if}
      <span class={['shrink-0 font-medium', TITLE[reading.tone]]} data-restart-title>{reading.title}</span>
      <FadeText class="min-w-0 flex-1 text-muted-foreground" text={`· ${reading.line}`} data-restart-line />
      {#if reading.progress !== null}
        <span class="h-1 w-28 shrink-0 overflow-hidden rounded-full bg-status-in-work/20" aria-hidden="true">
          <span class="block h-full rounded-full bg-status-in-work transition-[width]" style:width={`${reading.progress * 100}%`}></span>
        </span>
      {/if}
      {#if reading.details.length > 0}
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-0.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          aria-expanded={open}
          onclick={() => (open = !open)}
        >
          Details<ChevronRight class={['size-3 transition-transform', open && 'rotate-90']} />
        </button>
      {/if}
      {#if elapsed !== ''}<span class="shrink-0 tabular text-muted-foreground">{elapsed}</span>{/if}
      {#if reading.dismiss}
        <button
          type="button"
          class="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          aria-label="Dismiss"
          onclick={() => restart.dismiss()}
        >
          <X class="size-3.5" />
        </button>
      {/if}
    </div>
    {#if open}
      <div class="mx-4 mb-2 grid gap-1 rounded-md border bg-sunken px-2 py-1.5">
        {#each reading.details as line, index (index)}
          <p class="stamp text-meta leading-relaxed break-words text-muted-foreground select-text">{line}</p>
        {/each}
      </div>
    {/if}
  </div>
{/if}
