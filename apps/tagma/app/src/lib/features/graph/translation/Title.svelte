<script lang="ts">
  import { codeParts } from '$lib/shared/codeParts.js';
  import type { TranslationLens } from './Lens.svelte.js';

  let { lens, original }: { lens: TranslationLens; original: string } = $props();

  const part = $derived(lens.title);
  const shown = $derived(part?.state === 'translated' ? (part.text ?? part.source) : original);
</script>

{#snippet words(text: string)}
  {#each codeParts(text) as piece, index (index)}
    {#if piece.code}<code class="rounded-sm bg-selected px-1 font-mono">{piece.text}</code>{:else}{piece.text}{/if}
  {/each}
{/snippet}

<div
  class={['title text-title', part?.state === 'pending' && 'opacity-40']}
  lang={part?.state === 'translated' ? (lens.language() ?? undefined) : undefined}
  aria-label="Title"
>
  {@render words(shown.trim() === '' ? 'Untitled' : shown)}
</div>
<div class="mt-1.5 text-small text-muted-foreground">{@render words(original)}</div>
