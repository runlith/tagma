<script lang="ts">
  import { type ChatMarkdownBody, useChatRendering } from '@runlith/chat-ui/renderers';

  let { body }: { body: ChatMarkdownBody } = $props();

  const rendering = useChatRendering();
</script>

{@render rendering.markdown(body)}
