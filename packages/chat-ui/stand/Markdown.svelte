<script lang="ts" module>
  import { MarkdownRenderer } from '@runlith/markdown/render';
  const renderer = new MarkdownRenderer();
</script>

<script lang="ts">
  import { codeColours } from '@runlith/markdown/render';
  import type { ChatMarkdownBody } from '@feed/renderers';

  let { body }: { body: ChatMarkdownBody } = $props();
  const sizes = { body: 'text-body leading-6', ui: 'text-ui leading-5', small: 'text-small leading-5' };
  const blocks = $derived(
    /\S/.test(body.text) ? renderer.render({ text: body.text, key: body.cacheKey, streaming: body.streaming ?? false }) : [],
  );
</script>

<div class={['stand-markdown', sizes[body.size ?? 'body'], body.class]} data-body={body.cacheKey}>
  {#each blocks as block (block.key)}<div {@attach codeColours(block)}>{@html block.html}</div>{/each}
</div>
