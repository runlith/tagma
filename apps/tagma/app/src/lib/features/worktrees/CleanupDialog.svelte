<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { CleanupBlocker, CleanupCandidate } from '@tagma/server/worktrees/contract/wire/cleanup';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import { CLEANUP_THRESHOLDS, Cleanup } from './Cleanup.svelte.js';
  import { Finishing } from './Finishing.svelte.js';
  import { stands } from './PlaceStanding.js';
  import StandingList from './StandingList.svelte';
  import WorktreeSwatch from './WorktreeSwatch.svelte';

  const cleanup = Cleanup.use();
  const finishing = Finishing.use();
  const workspace = Workspace.use();
  const project = $derived(workspace.find(cleanup.aim.projectId)?.name ?? String(cleanup.aim.projectId));

  const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

  const BLOCKER_WORDS: Record<CleanupBlocker['kind'], (count: number) => string> = {
    'agent-running': (count) => (count === 1 ? 'an agent is running' : `${count} agents are running`),
    uncommitted: (count) => `${plural(count, 'file', 'files')} uncommitted`,
    unpushed: (count) => `${plural(count, 'commit', 'commits')} not pushed`,
    unread: () => 'its branch could not be read',
    'merge-waiting': () => 'a merge is waiting',
  };

  const blockerWord = (blocker: CleanupBlocker): string => BLOCKER_WORDS[blocker.kind](blocker.count);

  const reasonWord = (candidate: CleanupCandidate): string =>
    candidate.reason === 'idle' ? `idle ${candidate.idleDays}d` : candidate.reason;

  const outcomeWord = { deleted: 'deleted', 'branch-kept': 'deleted, branch kept', refused: 'not cleaned' } as const;

  const chosenCount = $derived(cleanup.chosen.length);
  const allChosen = $derived(cleanup.takeable.length > 0 && chosenCount === cleanup.takeable.length);
  const refused = $derived(cleanup.outcomes.filter((one) => one.outcome === 'refused'));
  const done = $derived(cleanup.outcomes.length - refused.length);
  const ended = $derived(cleanup.outcomes.reduce((sum, one) => sum + one.ended.length, 0));
</script>

<Dialog.Root bind:open={cleanup.open}>
  <Dialog.Content class="sm:max-w-xl" data-worktree-cleanup>
    <Dialog.Header>
      <Dialog.Title class="text-page">Clean up worktrees in {project}</Dialog.Title>
      <Dialog.Description>
        Worktrees that are merged, missing or idle. Deleting one removes its folder and record; its branch stays only while it holds work
        its base lacks.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex items-center gap-2 text-ui">
      <span class="text-muted-foreground">Idle after</span>
      <span class="inline-flex rounded-md border p-0.5">
        {#each CLEANUP_THRESHOLDS as days (days)}
          <button
            type="button"
            class={[
              'h-6 rounded-sm px-2 text-small tabular-nums transition-colors',
              cleanup.idleAfterDays === days ? 'bg-selected text-foreground' : 'text-muted-foreground hover:text-foreground',
            ]}
            aria-pressed={cleanup.idleAfterDays === days}
            onclick={() => cleanup.aimIdle(days)}
          >
            {days} days
          </button>
        {/each}
      </span>
      <span class="flex-1"></span>
      {#if cleanup.takeable.length > 0}
        <label class="flex items-center gap-2 text-ui text-muted-foreground">
          <input type="checkbox" class="size-3.5 accent-(--color-brand)" checked={allChosen} onchange={() => cleanup.toggleAll()} />
          All that can go
        </label>
      {/if}
    </div>

    {#if cleanup.listed}
      <div class="-mx-2 max-h-[22rem] min-h-24 overflow-y-auto" data-cleanup-candidates>
        {#if !cleanup.read}
          <p class="px-2 py-3 text-ui text-muted-foreground">Reading…</p>
        {:else if cleanup.nothing}
          <p class="px-2 py-3 text-ui text-muted-foreground">Nothing to clean up: no worktree is merged, missing or idle that long.</p>
        {/if}
        {#each cleanup.candidates as candidate (candidate.rootId)}
          {@const blocked = candidate.blockers.length > 0}
          <label
            class={['flex items-start gap-2 rounded-md px-2 py-1.5', blocked ? 'cursor-default' : 'cursor-pointer hover:bg-hover']}
            data-cleanup-row={candidate.name}
          >
            <input
              type="checkbox"
              class="mt-0.5 size-3.5 shrink-0 accent-(--color-brand)"
              checked={cleanup.selected.has(candidate.rootId)}
              disabled={blocked || cleanup.cleaning}
              onchange={() => cleanup.toggle(candidate.rootId)}
            />
            <span class="grid min-w-0 flex-1 gap-0.5">
              <span class="flex min-w-0 items-center gap-2">
                <WorktreeSwatch row={{ hue: candidate.hue, kind: 'tagma' }} />
                <span class={['min-w-0 truncate font-mono text-small', blocked && 'text-muted-foreground']}
                  >{candidate.branch ?? candidate.name}</span
                >
                <span
                  class={[
                    'shrink-0 rounded-full px-1.5 text-meta tabular-nums',
                    candidate.reason === 'missing' ? 'text-destructive' : 'text-muted-foreground',
                  ]}
                  style:background="color-mix(in oklch, currentColor 11%, transparent)"
                  data-cleanup-reason={candidate.reason}
                >
                  {reasonWord(candidate)}
                </span>
              </span>
              <span class="break-all font-mono text-small text-muted-foreground">{candidate.folder}</span>
              {#if blocked}
                <span class="text-small text-status-stale" data-cleanup-blockers>
                  Kept: {candidate.blockers.map(blockerWord).join(' · ')}
                </span>
              {:else}
                {@const running = finishing.standingIn(candidate.rootId)}
                {#if running !== null && stands(running)}
                  <StandingList standing={running} lead="Cleaning up ends what still runs here" />
                {/if}
              {/if}
            </span>
          </label>
        {/each}
        {#if cleanup.more}
          <button
            type="button"
            class="px-2 py-1 text-small text-muted-foreground hover:text-foreground"
            onclick={() => void cleanup.readMore()}
          >
            Show {cleanup.total - cleanup.candidates.length} more
          </button>
        {/if}
      </div>
    {/if}

    {#if cleanup.outcomes.length > 0}
      <div class="grid gap-1 rounded-md bg-hover px-3 py-2 text-small" data-cleanup-outcomes>
        <span class="font-medium">
          {plural(done, 'worktree', 'worktrees')} cleaned up{refused.length > 0 ? `, ${refused.length} not` : ''}
        </span>
        {#if ended > 0}
          <span class="text-muted-foreground" data-cleanup-ended={ended}
            >{plural(ended, 'execution', 'executions')} running there ended</span
          >
        {/if}
        {#each cleanup.outcomes as one (one.rootId)}
          <span class="flex min-w-0 items-start gap-1.5 text-muted-foreground" data-cleanup-outcome={one.outcome}>
            {#if one.outcome === 'refused'}
              <TriangleAlert class="mt-0.5 size-3 shrink-0 text-destructive" />
            {:else}
              <Check class="mt-0.5 size-3 shrink-0 text-status-done" />
            {/if}
            <span class="min-w-0">
              <span class="font-mono text-foreground/85">{one.name ?? one.rootId}</span>
              {outcomeWord[one.outcome]}{one.refusal === null ? '' : `: ${one.refusal.message}`}
            </span>
          </span>
        {/each}
      </div>
    {/if}

    <Dialog.Footer>
      <Button type="button" variant="ghost" onclick={() => (cleanup.open = false)}>Close</Button>
      <Button
        type="button"
        variant="confirm"
        disabled={chosenCount === 0 || cleanup.cleaning}
        onclick={() => void cleanup.clean()}
        data-cleanup-confirm
      >
        {cleanup.cleaning ? 'Cleaning up…' : chosenCount === 0 ? 'Clean up' : `Clean up ${plural(chosenCount, 'worktree', 'worktrees')}`}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
