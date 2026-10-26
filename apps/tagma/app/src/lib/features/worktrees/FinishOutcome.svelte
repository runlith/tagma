<script lang="ts">
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { Finishing, type FinishView } from './Finishing.svelte.js';
  import { endedWords, graphWords } from './finishWords.js';
  import WorktreeSwatch from './WorktreeSwatch.svelte';

  let { view }: { view: Extract<FinishView, { readonly kind: 'merged' | 'deleted' | 'updated' | 'renamed' | 'pull-request' }> } = $props();

  const finishing = Finishing.use();

  const LABEL = 'text-small font-medium text-muted-foreground';
</script>

{#if view.kind === 'merged'}
  <Dialog.Header>
    <Dialog.Title class="flex min-w-0 items-center gap-2 text-page">
      <WorktreeSwatch row={view.row} size="md" />
      <span class="min-w-0 truncate"
        >Merged <span class="font-mono text-ui">{view.merged.branch.name}</span> into {view.merged.base.branch}</span
      >
    </Dialog.Title>
    <Dialog.Description>
      {view.merged.mode === 'merge' ? 'Merge commit' : view.merged.mode === 'squash' ? 'Squashed' : 'Rebased'} · {view.merged.base.branch} @ {view.merged.base.head.slice(
        0,
        7,
      )}
    </Dialog.Description>
  </Dialog.Header>
  {@const after = view.merged.after}
  <div class="grid gap-2 text-ui" data-merge-outcome>
    <div class="grid gap-0.5">
      <span class={LABEL}>Graph</span>
      {#each graphWords(view.merged.graph) as line (line)}
        <span>{line}</span>
      {/each}
    </div>
    <div class="grid gap-0.5">
      <span class={LABEL}>Worktree</span>
      {#if after.refusal !== null}
        <span class="text-destructive">Not deleted: {after.refusal.message}</span>
      {:else if after.deleted !== null}
        <span>
          Deleted{after.deleted.branch.status === 'deleted'
            ? `, and branch ${after.deleted.branch.name} deleted.`
            : `; branch kept: ${after.deleted.branch.reason}`}
        </span>
        {#if endedWords(after.deleted.ended) !== null}
          <span class="text-muted-foreground" data-finish-ended>{endedWords(after.deleted.ended)}</span>
        {/if}
      {:else}
        <span>Still standing; delete it from its menu when you are done.</span>
      {/if}
    </div>
  </div>
  <Dialog.Footer>
    <Button onclick={() => finishing.close()}>Done</Button>
  </Dialog.Footer>
{:else if view.kind === 'deleted'}
  <Dialog.Header>
    <Dialog.Title class="text-ui">
      {view.answer.branch.status === 'deleted' ? 'Worktree and branch deleted' : 'Worktree deleted, branch kept'}
    </Dialog.Title>
    <Dialog.Description class="text-small">
      {view.answer.branch.status === 'deleted'
        ? `Branch ${view.answer.branch.name} is gone; its commits stand in its base.`
        : view.answer.branch.reason}
    </Dialog.Description>
  </Dialog.Header>
  {#if endedWords(view.answer.ended) !== null}
    <span class="text-ui" data-finish-ended>{endedWords(view.answer.ended)}</span>
  {/if}
  {#if view.answer.branch.status === 'kept' && view.answer.branch.commits.length > 0}
    <ul class="grid max-h-60 gap-0.5 overflow-y-auto text-small">
      {#each view.answer.branch.commits as commit (commit.sha)}
        <li class="flex min-w-0 gap-2">
          <span class="shrink-0 font-mono text-muted-foreground">{commit.sha.slice(0, 7)}</span>
          <span class="min-w-0 truncate">{commit.subject}</span>
        </li>
      {/each}
    </ul>
  {/if}
  <Dialog.Footer><Button onclick={() => finishing.close()}>Done</Button></Dialog.Footer>
{:else if view.kind === 'updated'}
  <Dialog.Header>
    <Dialog.Title class="text-ui">Update handed to the worktree's lead thread</Dialog.Title>
    <Dialog.Description class="text-small">
      Thread <span class="font-mono">{view.answer.threadId.slice(0, 8)}</span> is asked to merge {view.answer.base} into
      <span class="font-mono">{view.row.branch ?? view.row.name}</span> and resolve what conflicts; the message was {view.answer.delivery}.
    </Dialog.Description>
  </Dialog.Header>
  <Dialog.Footer><Button onclick={() => finishing.close()}>Done</Button></Dialog.Footer>
{:else if view.kind === 'renamed'}
  {@const remote = view.answer.remote}
  {@const link =
    remote.status === 'moved'
      ? (remote.pullRequest?.opened.url ?? null)
      : remote.status === 'kept'
        ? (remote.pullRequest?.url ?? null)
        : null}
  <Dialog.Header>
    <Dialog.Title class="text-ui">Renamed to <span class="font-mono">{view.answer.to}</span></Dialog.Title>
    <Dialog.Description class="text-small">
      {#if remote.status === 'unpublished'}
        The branch was never pushed, so no remote changed.
      {:else if remote.status === 'moved'}
        Pushed to {remote.remote} as <span class="font-mono">{view.answer.to}</span>, which it now tracks.
      {:else}
        {remote.remote} keeps <span class="font-mono">{remote.branch}</span>, and Tagma pushes this branch there: {remote.reason}.
      {/if}
    </Dialog.Description>
  </Dialog.Header>
  {#if remote.status !== 'unpublished'}
    <div class="grid gap-1 text-ui" data-rename-outcome={remote.status}>
      {#if remote.status === 'moved'}
        <span class={remote.old.deleted ? '' : 'text-muted-foreground'}>
          {remote.old.deleted
            ? `The old remote branch ${view.answer.from} was deleted.`
            : `The old remote branch stays: ${remote.old.reason}.`}
        </span>
        {#if remote.pullRequest !== null}
          <span>
            Pull request #{remote.pullRequest.opened.number} opened; #{remote.pullRequest.closed.number}
            {remote.pullRequest.closing === null ? 'closed with a link to it.' : `could not be closed: ${remote.pullRequest.closing}`}
          </span>
        {/if}
      {/if}
      {#if link !== null}
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex w-fit items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
        >
          <ExternalLink class="size-3.5" />
          {link}
        </a>
      {/if}
    </div>
  {/if}
  <Dialog.Footer><Button onclick={() => finishing.close()}>Done</Button></Dialog.Footer>
{:else}
  <Dialog.Header>
    <Dialog.Title class="text-ui">{view.answer.opened ? 'Pull request opened' : 'A pull request is already open'}</Dialog.Title>
    <Dialog.Description class="text-small">
      <span class="font-mono">{view.answer.branch}</span> pushed to {view.answer.remote}, against {view.answer.base}.
      {#if view.answer.uncommitted > 0}
        {view.answer.uncommitted} uncommitted {view.answer.uncommitted === 1 ? 'path is' : 'paths are'} not in it.
      {/if}
    </Dialog.Description>
  </Dialog.Header>
  <a
    href={view.answer.url}
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex w-fit items-center gap-1.5 text-ui font-medium text-foreground underline-offset-4 hover:underline"
  >
    <ExternalLink class="size-3.5" />
    {view.answer.url}
  </a>
  <Dialog.Footer><Button onclick={() => finishing.close()}>Done</Button></Dialog.Footer>
{/if}
