<script lang="ts">
  import { inStep } from '@runlith/chat-ui/inStep';
  import { cn } from '$lib/shared/utils.js';

  let { muted = false, class: className }: { muted?: boolean; class?: string } = $props();
</script>

<span
  class={cn('block size-1.75 shrink-0 animate-breathe', muted ? 'bg-muted-foreground' : 'bg-status-in-work', className)}
  aria-hidden="true"
  {@attach inStep}
></span>
