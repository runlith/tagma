<script lang="ts">
  import type { ChatEntryContext } from './renderers';
  import type { ChatRewind } from './rewind';
  import type { ChatTimelineItem } from './timeline';

  type Props = {
    item: Extract<ChatTimelineItem, { kind: 'rewind' }>;
    rewind: ChatRewind;
    context: ChatEntryContext;
  };

  let { item, rewind, context }: Props = $props();
  const words = $derived(rewind.words);
  const restorable = $derived(rewind.restorable(item.rewind));
</script>

{#snippet acts()}
  <button
    type="button"
    class="cursor-pointer rounded-md px-1.5 py-0.5 font-medium text-primary transition hover:bg-hover"
    aria-expanded={item.open}
    onclick={() => context.setExpanded(item.key, !item.open)}>{item.open ? words.hide() : words.show()}</button
  >
  {#if restorable}
    <button
      type="button"
      class="cursor-pointer rounded-md px-1.5 py-0.5 font-medium text-primary transition hover:bg-hover disabled:cursor-default disabled:opacity-40"
      disabled={rewind.busy}
      onclick={() => rewind.restore(item.rewind)}>{words.restore()}</button
    >
  {/if}
{/snippet}

{#if item.scope === 'from'}
  <div
    class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-border px-3 py-2 text-ui text-muted-foreground"
  >
    <span class="font-mono text-primary" aria-hidden="true">↶</span>
    <span class="min-w-0 flex-1">{words.rewoundTurns(item.turns)} · {words.unseen()}</span>
    <span class="flex items-center gap-1">{@render acts()}</span>
  </div>
{:else}
  <div class="flex min-w-0 items-center gap-2 border-l-2 border-border py-1 pl-3 text-ui text-muted-foreground">
    <s class="min-w-0 truncate text-muted-foreground/70">{item.words || words.wordless()}</s>
    <span class="shrink-0">· {words.dropped()}</span>
    <span class="ml-auto flex shrink-0 items-center gap-1">{@render acts()}</span>
  </div>
{/if}
