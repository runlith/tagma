<script lang="ts">
  import Globe from '@lucide/svelte/icons/globe';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';

  let { icon, loading = false }: { icon: string | null; loading?: boolean } = $props();

  let broken = $state<string | null>(null);
</script>

{#if loading}
  <Waiting class="size-3.5 text-muted-foreground" label="Loading" />
{:else if icon !== null && icon !== broken}
  <img src={icon} alt="" class="size-3.5 shrink-0" draggable="false" onerror={() => (broken = icon)} />
{:else}
  <Globe class="size-3.5 shrink-0" />
{/if}
