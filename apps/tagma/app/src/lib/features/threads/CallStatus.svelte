<script lang="ts">
  import type { CallRecord } from '@runlith/agent/callProgress';
  import { formatLimit, formatSpan } from '$lib/shared/figures.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { callStatus } from './activityRows.js';

  let { call }: { call: CallRecord } = $props();

  const clock = WallClock.use();
  $effect(() => clock.watch());

  const since = $derived(call.admittedAt ?? call.startedAt);
  const elapsed = $derived(Math.max(0, clock.now - since));
  const limit = $derived(call.expiresAt === null ? null : Math.max(0, call.expiresAt - since));
</script>

<span class="ml-1 flex shrink-0 items-baseline gap-3 font-mono text-meta text-muted-foreground/60 tabular-nums" data-call-status>
  <span>{callStatus(call, 0, 0).toLowerCase()}</span>
  <span>
    <span class="text-muted-foreground/90">{formatSpan(elapsed)}</span>{#if limit !== null}&nbsp;of {formatLimit(limit)}{/if}
  </span>
</span>
