<script lang="ts">
  import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';

  let { title, skill = null }: { title: string; skill?: string | null } = $props();

  const seats = ThreadSeats.use();
</script>

<Button size="sm" onclick={() => seats.ask({ kind: 'text', text: skill === null ? `With ${title}, ` : `$${skill} ` })}>
  <MessageSquarePlus class="size-3.5" />Try it in a new thread
</Button>
