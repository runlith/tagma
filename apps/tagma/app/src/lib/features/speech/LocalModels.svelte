<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import X from '@lucide/svelte/icons/x';
  import type { SpeechStatus } from '@tagma/server/speech/contract/wire/status';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import Card from './Card.svelte';
  import { Installs } from './Installs.svelte.js';
  import { SpeechRepo } from './Repo.js';

  let { local }: { local: SpeechStatus['local'] } = $props();

  const notices = Notices.use();
  const speech = SpeechRepo.use();
  const installs = Installs.use();

  let busy = $state<string | null>(null);
  let cancelling = $state<string | null>(null);

  const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

  function sized(bytes: number): string {
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
  }

  async function act(id: string, work: () => Promise<unknown>): Promise<void> {
    busy = id;
    try {
      await work();
      await speech.status.refresh();
    } catch (error: unknown) {
      notices.refusal(error);
    } finally {
      busy = null;
    }
  }

  async function cancel(id: string): Promise<void> {
    cancelling = id;
    try {
      await act(id, () => speech.remove.run(id, { throwOnError: true }));
    } finally {
      cancelling = null;
    }
  }

  const total = $derived(local.reduce((sum, model) => sum + (model.installed ? model.size : model.partial), 0));
</script>

<Card title="Local models" fact={local.length === 0 ? 'none offered' : `${sized(total)} on disk`}>
  {#each local as model (model.id)}
    {@const live = installs.standing[model.id]}
    {@const failure = live === undefined ? model.failure : live.failure}
    {@const received = live !== undefined && live.failure === null ? live.received : model.received}
    {@const size = live?.total ?? model.size}
    {@const installing = received !== null && failure === null}
    {@const cancelled = cancelling === model.id}
    {@const running = installing || cancelled}
    <div class="grid gap-2 border-t border-vein py-3 first:border-t-0" data-local-model={model.id}>
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-ui font-medium">{model.label}</span>
        <span class="text-small text-muted-foreground">
          {#if cancelled}
            Cancelling the install…
          {:else if installing}
            {sized(received ?? 0)} of {sized(size)}
          {:else if model.installed}
            Installed · {sized(model.size)} on disk
          {:else if model.partial > 0}
            Interrupted · {sized(model.partial)} of {sized(model.size)} kept
          {:else}
            {sized(model.size)} to download
          {/if}
        </span>
        <span class="flex-1"></span>
        {#if !model.installed && !running}
          <Button
            size="sm"
            disabled={busy !== null}
            onclick={() => void act(model.id, () => speech.install.run(model.id, { throwOnError: true }))}
          >
            {model.partial > 0 ? 'Resume' : 'Install'}
          </Button>
        {/if}
        {#if running}
          <Button variant="outline" size="sm" disabled={busy !== null} onclick={() => void cancel(model.id)}>
            {#if cancelled}
              <Waiting class="size-3.5" />Cancelling…
            {:else}
              <X class="size-3.5" />Cancel install
            {/if}
          </Button>
        {/if}
        {#if model.installed || (!running && model.partial > 0)}
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onclick={() => void act(model.id, () => speech.remove.run(model.id, { throwOnError: true }))}
          >
            {model.installed ? 'Remove' : 'Discard'}
          </Button>
        {/if}
      </div>
      {#if running}
        <div
          class="h-1.5 overflow-hidden rounded-full bg-vein-strong"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={size}
          aria-valuenow={received}
        >
          <div class="h-full rounded-full bg-foreground" style:width="{Math.min(100, ((received ?? 0) / Math.max(1, size)) * 100)}%"></div>
        </div>
      {/if}
      {#if failure !== null && !cancelled}
        <p class="text-small text-destructive">The last install failed: {failure}</p>
      {/if}
    </div>
  {/each}
</Card>
