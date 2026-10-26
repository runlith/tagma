<script lang="ts">
  import FailureRow from '@runlith/chat-ui/FailureRow.svelte';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import type { RecapAttempt } from '@tagma/server/threads/contract/wire/recap';

  let { attempt }: { attempt: RecapAttempt } = $props();
</script>

{#if attempt.state === 'writing'}
  <div
    class="flex w-full min-w-0 items-center gap-2 rounded-lg border border-dashed border-primary/40 px-3 py-1.5 text-small text-muted-foreground"
    role="status"
    data-recap-attempt="writing"
  >
    <span class="shrink-0 font-mono text-meta font-medium text-primary">↳ Recap</span>
    <Waiting class="size-3 text-primary" />
    <span class="min-w-0 flex-1 truncate text-ui">Writing a recap of this thread…</span>
  </div>
{:else}
  <section class="w-full min-w-0" role="alert" data-recap-attempt="refused">
    <FailureRow
      id={`recap:${attempt.entryId}`}
      label="Recap not written"
      text={attempt.reason}
      notes={attempt.unblock}
      facts={[{ label: 'Code', value: attempt.code, mono: true }]}
    />
  </section>
{/if}
