<script lang="ts">
  import User from '@lucide/svelte/icons/user';
  import type { JournalSession } from '@tagma/server/graph/contract/wire/journal';
  import WriterBadge from '$lib/features/graph/WriterBadge.svelte';
  import { cn } from '$lib/shared/utils.js';

  let { session, class: className }: { session: JournalSession | null | undefined; class?: string } = $props();
</script>

{#if session === null}
  <span class={cn('flex min-w-0 items-center gap-1 text-ui text-muted-foreground', className)}>
    <User class="size-3.5 shrink-0" />Operator
  </span>
{:else}
  <WriterBadge writer={session} class={cn('max-w-none text-ui', className)} />
{/if}
