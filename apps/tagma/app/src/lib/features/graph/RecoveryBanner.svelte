<script lang="ts">
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import { Router } from '@runlith/layer/Router';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { currentBranch, currentProject } from '$lib/features/workspace/address.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { CHAT } from '$lib/features/workspace/surface.js';
  import { Recovery } from './Recovery.svelte.js';

  const recovery = Recovery.use();
  const notices = Notices.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const pending = $derived(recovery.pending);

  async function assign(): Promise<void> {
    const project = currentProject(router);
    const branch = currentBranch(router);
    try {
      const threadId = await recovery.assign();
      await router.goto(addresses.place(project, CHAT, threadId, branch));
    } catch (error) {
      notices.refusal(error);
    }
  }
</script>

{#if recovery.shown}
  <section class="flex shrink-0 items-center gap-3 border-b border-border bg-raised px-4 py-2 text-ui" aria-label="Graph recovery">
    <AlertTriangle class="size-4 shrink-0 text-destructive" />
    <div class="min-w-0 flex-1">
      {#if pending !== null}
        <p class="font-medium">Graph changes could not be merged</p>
        <p class="text-small text-muted-foreground">
          {pending.incoming} → {pending.branch}. The current graph remains available.
          {pending.conflicts.length} conflicted files.
          {#if recovery.total > 1}{recovery.total - 1} other merges await recovery.{/if}
        </p>
      {/if}
      {#if recovery.failure !== null}<p class="text-small text-destructive">{recovery.failure}</p>{/if}
      {#each recovery.unreadable as entry (entry.file)}
        <p class="text-small text-destructive">{entry.file}: {entry.error.code}: {entry.error.reason}</p>
      {/each}
    </div>
    {#if pending !== null}
      <button
        type="button"
        class="shrink-0 rounded-md border border-border px-3 py-1.5 text-ui hover:bg-hover disabled:opacity-50"
        disabled={recovery.busy}
        onclick={assign}
      >
        {recovery.busy ? 'Opening recovery…' : pending.threadId === null ? 'Assign to agent' : 'Open recovery'}
      </button>
    {/if}
    <Button type="button" variant="ghost" size="icon-sm" class="shrink-0" aria-label="Dismiss" onclick={() => recovery.dismiss()}>
      <X class="size-3.5" />
    </Button>
  </section>
{/if}
