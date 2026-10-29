<script lang="ts">
  import Gauge from '@lucide/svelte/icons/gauge';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { conditionsOf } from '@tagma/server/browser/contract/wire/emulation';
  import type { Page, Started } from '@tagma/server/browser/contract/wire/page';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import { timeCompact } from '$lib/shared/time.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import Working from '$lib/shared/ui/Working.svelte';
  import { Door } from '$lib/wire/Door.js';

  type Measure = 'conditions' | 'trace' | 'recording';

  let { page, touch = false }: { page: Page; touch?: boolean } = $props();

  const door = Door.use();
  const names = ThreadNames.use();
  const clock = WallClock.use();

  const stopping = new SvelteSet<string>();
  let problem = $state<{ readonly page: string; readonly text: string } | null>(null);

  const conditions = $derived(conditionsOf(page.live.conditions));

  $effect(() => {
    if (page.live.trace !== null || page.live.recording !== null) return clock.watch();
  });

  const ends = {
    conditions: (id: Page['id'], lens: { project: string }) => door.perform('emulate_page', { page: id, conditions: false }, lens),
    trace: (id: Page['id'], lens: { project: string }) => door.perform('trace_page', { page: id, action: 'stop' }, lens),
    recording: (id: Page['id'], lens: { project: string }) => door.perform('record_page', { page: id, action: 'stop' }, lens),
  };

  const LABELS: Record<Measure, string> = {
    conditions: 'Reset test conditions',
    trace: 'Stop the trace',
    recording: 'Stop the recording',
  };

  async function end(measure: Measure): Promise<void> {
    const id = page.id;
    const key = `${id}:${measure}`;
    if (problem?.page === id) problem = null;
    stopping.add(key);
    try {
      await ends[measure](id, { project: String(page.projectId) });
    } catch (error) {
      problem = { page: id, text: error instanceof Error ? error.message : String(error) };
    } finally {
      stopping.delete(key);
    }
  }

  const since = (started: Started): string => {
    const running = `for ${timeCompact(started.at, clock.now, true)}`;
    if (started.by === null) return running;
    return `${running} by ${names.of(started.by)?.label ?? 'an agent'}`;
  };
</script>

{#snippet row(measure: Measure, words: string, detail: string, act: string)}
  {@const pending = stopping.has(`${page.id}:${measure}`)}
  <div
    class={['flex shrink-0 items-center gap-2 border-b bg-raised', touch ? 'min-h-11 py-1 pr-1 pl-4 text-body' : 'px-3 py-1.5 text-small']}
    data-page-measure={measure}
  >
    {#if measure === 'conditions'}
      <Gauge class={[touch ? 'size-4' : 'size-3.5', 'shrink-0 text-muted-foreground']} />
    {:else}
      <span class={['grid shrink-0 place-items-center', touch ? 'size-4' : 'size-3.5']}><Working /></span>
    {/if}
    <span class="shrink-0">{words}</span>
    <FadeText class="min-w-0 flex-1 text-muted-foreground" text={detail} />
    <Button
      size="sm"
      variant="ghost"
      class={touch ? 'min-h-11 px-4 text-body' : undefined}
      aria-label={LABELS[measure]}
      disabled={pending}
      onclick={() => void end(measure)}
    >
      {#if pending}<Waiting class="size-3" label={LABELS[measure]} />{:else}{act}{/if}
    </Button>
  </div>
{/snippet}

{#if conditions !== null}
  {@render row('conditions', 'Under test conditions', conditions, 'Reset')}
{/if}
{#if page.live.trace !== null}
  {@render row('trace', 'Tracing the page', since(page.live.trace), 'Stop')}
{/if}
{#if page.live.recording !== null}
  {@render row('recording', 'Recording the page', since(page.live.recording), 'Stop')}
{/if}
{#if problem !== null && problem.page === page.id}
  <p class={['shrink-0 border-b bg-sunken text-destructive', touch ? 'px-4 py-2 text-small' : 'px-3 py-1.5 text-small']}>{problem.text}</p>
{/if}
