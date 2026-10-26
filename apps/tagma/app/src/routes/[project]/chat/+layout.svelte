<script lang="ts">
  let { data, children } = $props();

  const ChatShell = $derived(data.ChatShell);
</script>

<ChatShell>{@render children()}</ChatShell>
