<script lang="ts">
  import type { ChatEntryContext } from '../renderers';
  import { useChatStrings } from '../strings';
  import type { ToolActivityEntry } from '../activity';
  import { clipFade } from '../clipFade';
  import CopyAddress from './CopyAddress.svelte';

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

  const BLOCK = 'max-h-96 overflow-auto rounded-lg border border-border/60 bg-background/60';
  const MONO = 'font-mono text-small leading-5';

  function payloadText(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
</script>

{#if hasPayload}
  <div class="grid gap-2">
    <button
      type="button"
      class="w-fit cursor-pointer text-small text-muted-foreground/50 underline-offset-2 transition hover:text-muted-foreground hover:underline"
      aria-expanded={rawOpen}
      onclick={() => context.setExpanded(rawKey, !rawOpen)}
    >
      {strings.showDetails()}
    </button>
    {#if rawOpen}
      <div class="grid gap-1.5">
        <div class="flex items-center gap-x-3 font-mono text-meta text-muted-foreground/50">
          <span class="shrink-0">{entry.toolName}</span>
          <span class="min-w-0" data-fade {@attach clipFade}>{entry.toolCallId}</span>
          {#if entry.toolState !== 'output-available'}<span class="shrink-0">{entry.toolState}</span>{/if}
          {#if address}<CopyAddress {address} {context} id={entry.id} />{/if}
        </div>
        {#if entry.toolInput !== undefined}
          <div class="text-small text-muted-foreground/50">{strings.toolInput()}</div>
          <pre class={[BLOCK, MONO, 'p-3 whitespace-pre-wrap text-muted-foreground/70']}>{payloadText(entry.toolInput)}</pre>
        {/if}
        {#if entry.toolOutput !== undefined}
          <div class="text-small text-muted-foreground/50">{strings.toolOutput()}</div>
          <pre class={[BLOCK, MONO, 'p-3 whitespace-pre-wrap text-muted-foreground/70']}>{modelText ?? payloadText(entry.toolOutput)}</pre>
        {/if}
      </div>
    {/if}
  </div>
{/if}
