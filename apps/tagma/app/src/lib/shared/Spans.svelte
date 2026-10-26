<script lang="ts">
  import type { Span } from '@runlith/search-text/highlight';

  let { text, spans }: { text: string; spans: readonly Span[] } = $props();

  const parts = $derived.by(() => {
    const found: { readonly text: string; readonly marked: boolean }[] = [];
    let at = 0;
    for (const span of spans) {
      if (span.start > at) found.push({ text: text.slice(at, span.start), marked: false });
      found.push({ text: text.slice(span.start, span.end), marked: true });
      at = span.end;
    }
    if (at < text.length) found.push({ text: text.slice(at), marked: false });
    return found;
  });
</script>

{#each parts as part}{#if part.marked}<mark class="rounded-sm bg-selected text-foreground underline decoration-current underline-offset-2"
      >{part.text}</mark
    >{:else}{part.text}{/if}{/each}
