<script lang="ts">
  import { clipFade } from '../clipFade';
  import RailRow from '../RailRow.svelte';
  import { type ChatEntryOf, useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';

  let { entry }: { entry: ChatEntryOf<'restart'> } = $props();

  const rendering = useChatRendering();
  const strings = useChatStrings();
  const stopped = $derived(entry.stoppedRunId !== undefined);
  const by = $derived(entry.byThreadId);
  const name = $derived(by === undefined ? null : (rendering.threadName?.(by) ?? by));
</script>

<div data-message-id={entry.id} class="mr-auto w-full min-w-0 max-w-feed">
  <RailRow>
    <p class="flex min-w-0 items-baseline gap-1 text-ui text-muted-foreground">
      {#if by === undefined}
        <span class="min-w-0">{strings.restarted('you', stopped)}</span>
      {:else}
        <button
          type="button"
          class="min-w-0 cursor-pointer font-medium text-foreground/80 underline-offset-2 hover:underline"
          data-fade
          {@attach clipFade}
          {@attach rendering.navigation.link({ kind: 'thread', threadId: by })}
        >
          {name}
        </button>
        <span class="shrink-0">{strings.restarted('agent', stopped)}</span>
      {/if}
    </p>
    {#if stopped && !entry.continued}
      <p class="text-ui text-muted-foreground">{strings.restartWaits()}</p>
    {/if}
    {#if entry.calls.length > 0}
      <p class="text-small text-muted-foreground/80">{strings.restartClosed(entry.calls.map((call) => call.toolName))}</p>
    {/if}
  </RailRow>
</div>
