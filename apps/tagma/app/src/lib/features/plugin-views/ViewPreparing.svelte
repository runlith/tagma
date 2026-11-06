<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';

  let { title }: { title: string } = $props();
</script>

<p class="flex items-center gap-2 px-3 py-2 text-small text-muted-foreground" role="status">
  <Waiting class="size-3" />
  Preparing {title}
</p>
