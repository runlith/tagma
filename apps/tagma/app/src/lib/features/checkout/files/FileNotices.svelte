<script lang="ts">
  import { holderName } from '$lib/features/worktrees/holders.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import type { OpenedDocument } from './OpenedDocument.svelte.js';

  let { opened, onCompare }: { opened: OpenedDocument; onCompare?: (() => void) | undefined } = $props();

  const names = ThreadNames.use();
  const notices = Notices.use();

  const saving = $derived(opened.saving);
  const holders = $derived(opened.holdersNow.map((hand) => holderName(hand.holder, (thread) => names.of(thread)?.label ?? null)));

  async function takeDisk(): Promise<void> {
    const undo = await opened.takeDisk();
    if (undo !== null) notices.undoable('Your changes to this file were replaced by the disk', undo);
  }
</script>

{#if saving.kind === 'conflict'}
  <div class="flex shrink-0 flex-wrap items-center gap-2 border-b bg-hover px-3 py-1.5 text-ui" role="alert" data-write-notice="conflict">
    <span class="min-w-0 flex-1 text-destructive">
      {holders.length === 0 ? 'The disk changed' : `${holders.join(', ')} changed`} the lines you are editing. Saving is paused.
    </span>
    {#if onCompare !== undefined}
      <Button variant="outline" size="xs" onclick={onCompare}>Compare</Button>
    {/if}
    <Button variant="outline" size="xs" disabled={opened.deciding} onclick={() => void opened.keepMine()}>Keep mine</Button>
    <Button variant="outline" size="xs" disabled={opened.deciding} onclick={() => void takeDisk()}>Take the disk</Button>
  </div>
{:else if saving.kind === 'refused'}
  <div class="flex shrink-0 flex-wrap items-center gap-2 border-b bg-hover px-3 py-1.5 text-ui" role="alert" data-write-notice="refused">
    <span class="min-w-0 flex-1 text-destructive">Not saved: {saving.reason}</span>
    <Button variant="outline" size="xs" onclick={() => void opened.flush()}>Try again</Button>
  </div>
{:else if opened.deleted}
  <div class="shrink-0 border-b bg-hover px-3 py-1.5 text-ui text-muted-foreground" data-write-notice="deleted">
    This file was deleted from the disk. Typing again creates it.
  </div>
{/if}
{#if opened.writes.unconfirmed !== null && saving.kind !== 'conflict'}
  <div class="shrink-0 border-b bg-hover px-3 py-1.5 text-small text-muted-foreground" data-write-notice="unconfirmed">
    Saved. The change record is catching up: {opened.writes.unconfirmed}
  </div>
{/if}
