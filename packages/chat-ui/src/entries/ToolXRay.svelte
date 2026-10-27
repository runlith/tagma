<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { ChatEntryContext } from '../renderers';
  import { useChatStrings } from '../strings';
  import type { ToolActivityEntry } from '../activity';
  import { clipFade } from '../clipFade';
  import CopyAddress from './CopyAddress.svelte';
  import Well from './Well.svelte';

  let {
    entry,
    context,
    address = null,
    modelText = null,
  }: {
    entry: ToolActivityEntry;
    context: ChatEntryContext;
    address?: string | null;
    modelText?: string | null;
  } = $props();

  const strings = useChatStrings();

  const rawKey = $derived(`${entry.id}:raw`);
  const rawOpen = $derived(context.expanded(rawKey));
  const hasPayload = $derived(entry.toolInput !== undefined || entry.toolOutput !== undefined);

  function payloadText(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
</script>

{#if hasPayload}
  <div class="grid min-w-0 gap-1.5">
    <button
      type="button"
      class="-ml-1 flex w-fit cursor-pointer items-center gap-0.5 rounded-sm px-1 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      aria-expanded={rawOpen}
      onclick={() => context.setExpanded(rawKey, !rawOpen)}
    >
      {strings.details()}<ChevronRight class={['size-3 transition-transform', rawOpen && 'rotate-90']} />
    </button>
    {#if rawOpen}
      <div class="grid min-w-0 gap-1.5">
        <div class="flex items-center gap-x-3 font-mono text-meta text-muted-foreground/50">
          <span class="shrink-0">{entry.toolName}</span>
          <span class="min-w-0" data-fade {@attach clipFade}>{entry.toolCallId}</span>
          {#if entry.toolState !== 'output-available'}<span class="shrink-0">{entry.toolState}</span>{/if}
          {#if address}<CopyAddress {address} {context} id={entry.id} />{/if}
        </div>
        {#if entry.toolInput !== undefined}
          <div class="text-small text-muted-foreground/70">{strings.toolInput()}</div>
          <Well id={`${entry.id}:input`} text={payloadText(entry.toolInput)} />
        {/if}
        {#if entry.toolOutput !== undefined}
          <div class="text-small text-muted-foreground/70">{strings.toolOutput()}</div>
          <Well id={`${entry.id}:output`} text={modelText ?? payloadText(entry.toolOutput)} />
        {/if}
      </div>
    {/if}
  </div>
{/if}
