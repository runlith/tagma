<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useChatStrings } from '../strings';

  type Props = {
    text: string;
    textClass: string;
    expanded: boolean;
    onToggle(): void;
    content?: Snippet<[string]>;
  };

  let { text, textClass, expanded, onToggle, content }: Props = $props();
  const strings = useChatStrings();

  const collapsible = $derived(text.length > 360 || text.split('\n').length > 6);
  const collapsed = $derived(collapsible && !expanded);
</script>

<div class={collapsed ? 'max-h-32 overflow-hidden mask-b-from-35% mask-b-to-100%' : ''}>
  <div class={textClass}>
    {#if content}{@render content(text)}{:else}{text}{/if}
  </div>
</div>
{#if collapsible}
  <button
    type="button"
    class="mt-1.5 cursor-pointer text-small font-medium text-muted-foreground transition hover:text-foreground"
    onclick={onToggle}
  >
    {collapsed ? strings.showMore() : strings.showLess()}
  </button>
{/if}
