<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import GitCompare from '@lucide/svelte/icons/git-compare';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import type { Component } from 'svelte';
  import { worktreeActs } from '$lib/features/threads/worktrees/acts.js';
  import ActLine from '$lib/features/worktrees/ActLine.svelte';
  import { baseName } from '$lib/features/worktrees/BaseReading.svelte.js';
  import FinishItems from '$lib/features/worktrees/FinishItems.svelte';
  import { Finishing, LEAVING_ACTS } from '$lib/features/worktrees/Finishing.svelte.js';
  import OutcomeLine from '$lib/features/worktrees/OutcomeLine.svelte';
  import WorktreeFacts from '$lib/features/worktrees/WorktreeFacts.svelte';
  import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import { toneOf } from '$lib/features/worktrees/tone.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Button, buttonVariants } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';

  let { row, onDone }: { row: WorktreePlace; onDone: () => void } = $props();

  const acts = worktreeActs();
  const finishing = Finishing.use();
  const reading = Worktrees.use().window();
  const facts = $derived(reading.rowOf(row.rootId));

  const tone = $derived(toneOf(row));
  const flight = $derived(finishing.inFlight(row.rootId));
  const outcome = $derived(flight === null ? finishing.outcomeOf(row.rootId) : null);
  const busy = $derived(finishing.actingOn(row.rootId) !== null);
  const leaving = $derived(flight !== null && LEAVING_ACTS.has(flight.act));
  const into = $derived(baseName(row));
  const gone = $derived(row.missing);

  type Step = { readonly label: string; readonly hint: string; readonly icon: Component; readonly run: () => void };

  const next = $derived.by<Step | null>(() => {
    if (row.kind !== 'tagma') return null;
    if (gone) return { label: 'Delete', hint: 'Delete this worktree', icon: Trash2, run: () => void finishing.remove(row) };
    if (row.pending?.state === 'waiting')
      return { label: 'Stop waiting', hint: `Stop waiting for ${into}`, icon: GitMerge, run: () => void finishing.cancelMerge(row) };
    if (row.base?.branch == null || facts?.stateFact.state !== 'current' || facts.mergeFact.state !== 'current') return null;
    if (facts.status === 'conflicts' || facts?.status === 'behind')
      return { label: 'Update', hint: `Update from ${into}`, icon: RefreshCw, run: () => void finishing.update(row) };
    if (facts?.status === 'ready')
      return { label: 'Merge…', hint: `Merge into ${into}`, icon: GitMerge, run: () => finishing.askMerge(row) };
    if (facts?.status === 'merged')
      return { label: 'Delete', hint: 'Delete this worktree', icon: Trash2, run: () => void finishing.remove(row) };
    return null;
  });

  const sub = $derived(row.kind === 'main' ? 'main checkout' : row.base === null ? null : `from ${into}`);

  function run(act: () => void): void {
    act();
    onDone();
  }

  const keep = (event: KeyboardEvent): void => event.stopPropagation();

  const TOOL = 'h-6 gap-1 px-1.5 text-small text-muted-foreground hover:text-foreground';
</script>

{#snippet tool(label: string, hint: string, Icon: Component, disabled: boolean, act: () => void)}
  <Tooltip text={hint}>
    <Button variant="ghost" size="xs" class={TOOL} {disabled} onkeydown={keep} onclick={() => run(act)}>
      <Icon class="size-3.5" />
      {label}
    </Button>
  </Tooltip>
{/snippet}

<div
  class="worktree-card grid gap-1 border-b px-3 pt-2 pb-2"
  style={tone === null ? undefined : `--tone: ${tone}`}
  data-worktree-card={row.name}
  {@attach reading.observe(row.rootId)}
>
  <div class="flex min-w-0 items-center gap-2">
    <WorktreeSwatch {row} size="md" />
    <FadeText class="flex-1 font-mono text-ui font-medium" text={row.branch ?? row.name} />
    {#if flight !== null}
      <ActLine {flight} class="max-w-[13rem] shrink" />
    {:else}
      <WorktreeFacts {row} {facts} unread={reading.unread} />
    {/if}
  </div>
  {#if sub !== null}
    <div class="min-w-0 pl-5 text-small text-muted-foreground"><FadeText text={sub} /></div>
  {/if}
  {#if outcome?.refusal != null}<OutcomeLine {outcome} class="pl-5" />{/if}
  <div class="-ml-1 mt-0.5 flex items-center gap-0.5 pl-4">
    {@render tool('Thread', 'New thread in this worktree', MessageSquarePlus, row.branch === null || gone || leaving, () =>
      acts.newAgent(row),
    )}
    {@render tool('Terminal', 'Open a terminal in this worktree', SquareTerminal, gone || leaving, () => acts.openTerminal(row))}
    {@render tool('Git', 'Open this worktree in Git', GitCompare, row.branch === null || gone, () => acts.openInGit(row))}
    <span class="flex-1"></span>
    {#if next !== null}
      {@const Icon = next.icon}
      <Tooltip text={next.hint}>
        <Button
          variant="secondary"
          size="xs"
          class="shrink-0"
          disabled={busy}
          onkeydown={keep}
          onclick={() => run(next.run)}
          data-worktree-next
        >
          <Icon class="size-3 shrink-0" />
          {next.label}
        </Button>
      </Tooltip>
    {/if}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: 'quiet', size: 'icon-sm' })}
        aria-label="More worktree actions"
        onkeydown={keep}
      >
        <Ellipsis class="size-3.5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-60">
        <FinishItems {row} {onDone}>
          {#snippet copies()}
            <DropdownMenu.Item icon={Copy} onSelect={() => run(() => acts.copyPath(row))}>Copy path</DropdownMenu.Item>
          {/snippet}
        </FinishItems>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</div>

<style>
  .worktree-card {
    background: color-mix(in oklch, var(--tone, var(--color-muted-foreground)) 6%, transparent);
  }
</style>
