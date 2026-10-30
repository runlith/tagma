<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Plus from '@lucide/svelte/icons/plus';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import ActLine from '$lib/features/worktrees/ActLine.svelte';
  import { Finishing, LEAVING_ACTS } from '$lib/features/worktrees/Finishing.svelte.js';
  import { leave } from '$lib/features/worktrees/leave.js';
  import OutcomeLine from '$lib/features/worktrees/OutcomeLine.svelte';
  import WorktreeFacts from '$lib/features/worktrees/WorktreeFacts.svelte';
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';
  import { toneOf } from '$lib/features/worktrees/tone.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { worktreeActs } from './acts.js';
  import WorktreeMenuItems from './MenuItems.svelte';

  let { row, open, current, onToggle }: { row: WorktreePlace; open: boolean; current: boolean; onToggle: () => void } = $props();

  const finishing = Finishing.use();
  const actions = worktreeActs();

  const tone = $derived(toneOf(row));
  const flight = $derived(finishing.inFlight(row.rootId));
  const outcome = $derived(flight === null ? finishing.outcomeOf(row.rootId) : null);
  const leaving = $derived(flight !== null && LEAVING_ACTS.has(flight.act));

  const YIELDS =
    'transition-opacity duration-150 ease-instrument group-hover/worktree:opacity-0 group-has-[:focus-visible]/worktree:opacity-0 group-has-[[data-state=open]]/worktree:opacity-0';
  const ACT = 'grid size-5 place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40';
</script>

<div
  class={['worktree-group group/worktree relative mt-1.5 min-w-0 rounded-md first:mt-0', current && 'worktree-group--current']}
  style={tone === null ? undefined : `--tone: ${tone}`}
  data-worktree-group={row.name}
  aria-busy={flight !== null}
  out:leave|global={{ finishing, rootId: row.rootId }}
>
  <button
    type="button"
    class="grid w-full grid-cols-[0.875rem_auto_minmax(0,1fr)_auto] items-center gap-x-1.5 rounded-md py-1 pr-2 pl-1.5 text-left text-small hover:bg-hover focus-visible:bg-selected focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring"
    aria-expanded={open}
    data-fold="worktree"
    onclick={onToggle}
  >
    <ChevronRight class={['size-3.5 text-muted-foreground/60 transition-transform', open && 'rotate-90']} />
    <WorktreeSwatch {row} class={['transition-opacity duration-300', flight !== null && 'opacity-50']} />
    <FadeText
      class={[
        'justify-self-start font-mono font-medium transition-colors duration-300',
        flight === null ? 'text-foreground/90' : 'text-foreground/60',
      ]}
      text={row.branch ?? row.name}
    />
    <span class={['flex min-w-0 items-center', YIELDS]}>
      {#if flight !== null}
        <ActLine {flight} class="max-w-[13rem] @max-[339px]:max-w-[7rem]" />
      {:else}
        <WorktreeFacts {row} diffClass="@max-[339px]:hidden" />
      {/if}
    </span>
  </button>
  {#if outcome !== null}
    <OutcomeLine {outcome} class="pr-1.5 pb-1 pl-6" />
  {/if}
  <div
    class="absolute top-0.5 right-1.5 flex items-center gap-px opacity-0 transition-opacity duration-150 ease-instrument group-hover/worktree:opacity-100 group-has-[:focus-visible]/worktree:opacity-100 group-has-[[data-state=open]]/worktree:opacity-100"
  >
    <button
      type="button"
      class={ACT}
      aria-label="New agent in {row.branch ?? row.name}"
      disabled={row.branch === null || row.missing || leaving}
      onclick={() => actions.newAgent(row)}
      data-worktree-new-agent
    >
      <Plus class="size-3.5" />
    </button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={ACT} aria-label="Worktree actions">
        <Ellipsis class="size-3.5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-72">
        <WorktreeMenuItems {row} />
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</div>

<style>
  .worktree-group--current {
    background: color-mix(in oklch, var(--tone, var(--color-muted-foreground)) 9%, transparent);
  }
  .worktree-group--current::before {
    content: '';
    position: absolute;
    left: calc(var(--spacing) * -1);
    top: var(--spacing);
    bottom: var(--spacing);
    width: 2px;
    border-radius: 0;
    background: var(--tone, var(--color-muted-foreground));
  }
</style>
