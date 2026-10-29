<script lang="ts">
  import type { ChatCodeBody } from '@feed/renderers';
  let { body }: { body: ChatCodeBody } = $props();
</script>

<pre
  class="font-mono text-small leading-5"
  {@attach () => {
    body.onRendered?.();
  }}><code>{body.text}</code></pre>
