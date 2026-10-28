<script lang="ts" module>
  import { MarkdownRenderer } from '@runlith/markdown/render';
  const renderer = new MarkdownRenderer();
</script>

<script lang="ts">
  import { fallbackBlock, type MarkdownHtml } from '@runlith/markdown/render';
  import { untrack } from 'svelte';
  import type { ChatMarkdownBody } from '@feed/renderers';

  let { body }: { body: ChatMarkdownBody } = $props();
  const sizes = { body: 'text-body leading-6', ui: 'text-ui leading-5', small: 'text-small leading-5' };
  let blocks = $state.raw<MarkdownHtml[]>([]);
  $effect(() => {
    const input = { text: body.text, key: body.cacheKey, streaming: body.streaming ?? false };
    if (!/\S/.test(input.text)) {
      blocks = [];
      return;
    }
    if (untrack(() => blocks.length === 0)) blocks = [fallbackBlock(input.text)];
    let active = true;
    void (async () => {
      const answer = await renderer.render(input);
      if (!active) return;
      blocks = answer;
      body.onRendered?.();
    })();
    return () => {
      active = false;
    };
  });
</script>

<div class={['stand-markdown', sizes[body.size ?? 'body'], body.class]} data-body={body.cacheKey}>
  {#each blocks as block (block.key)}<div>{@html block.html}</div>{/each}
</div>
