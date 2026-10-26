<script lang="ts">
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import type { Component } from 'svelte';
  import type { ChatRewind } from '../rewind';

  type Props = {
    runId: string;
    rewind: ChatRewind;
  };

  let { runId, rewind }: Props = $props();
  const words = $derived(rewind.words);
  const point = $derived(rewind.point(runId));
  const blocked = $derived(point !== undefined && !point.rewindable);

  type Act = { label: string; hint: string; icon: Component; run(): void; held: boolean; danger?: boolean };

  const acts = $derived<readonly Act[]>([
    { label: words.rewindHere(), hint: words.rewindHint(), icon: Undo2, run: () => void rewind.rewind(runId, 'from'), held: blocked },
    { label: words.branch(), hint: words.branchHint(), icon: GitBranch, run: () => rewind.branch(runId), held: false },
    {
      label: words.dropTurn(),
      hint: words.dropHint(),
      icon: Trash2,
      run: () => void rewind.rewind(runId, 'turn'),
      held: blocked,
      danger: true,
    },
  ]);
</script>

<div role="toolbar" aria-label={words.messageActions()} class="flex items-center gap-0.5">
  {#each acts as act (act.label)}
    {@const Icon = act.icon}
    <button
      type="button"
      class={[
        'inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 transition enabled:hover:bg-hover disabled:cursor-default disabled:opacity-40',
        act.danger ? 'hover:text-destructive' : 'hover:text-foreground',
      ]}
      title={act.held && point?.why ? point.why : act.hint}
      aria-label={act.label}
      disabled={rewind.busy || act.held}
      onclick={act.run}
    >
      <Icon class="size-3.5 shrink-0" />
      <span class="hidden @min-[34rem]:inline">{act.label}</span>
    </button>
  {/each}
</div>
