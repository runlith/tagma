<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import GitCompare from '@lucide/svelte/icons/git-compare';
  import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
  import SquareTerminal from '@lucide/svelte/icons/square-terminal';
  import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
  import type { Snippet } from 'svelte';
  import FinishItems from '$lib/features/worktrees/FinishItems.svelte';
  import { Finishing, LEAVING_ACTS } from '$lib/features/worktrees/Finishing.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { worktreeActs } from './acts.js';

  let { row, move }: { row: WorktreePlace; move?: Snippet } = $props();

  const actions = worktreeActs();
  const finishing = Finishing.use();

  const flight = $derived(finishing.inFlight(row.rootId));
  const outcome = $derived(flight === null ? finishing.outcomeOf(row.rootId) : null);
  const leaving = $derived(flight !== null && LEAVING_ACTS.has(flight.act));

  const base = $derived(row.base === null ? null : `From ${row.base.branch ?? 'a detached commit'} at ${row.base.commit.slice(0, 7)}`);
</script>

{#if outcome?.refusal != null}
  <DropdownMenu.Note tone="destructive" role="alert" text={`${outcome.words}: ${outcome.refusal.reason}`} />
  <DropdownMenu.Separator />
{/if}
<FinishItems {row}>
  {#snippet acts()}
    <DropdownMenu.Item
      icon={MessageSquarePlus}
      disabled={row.branch === null || row.missing || leaving}
      onSelect={() => actions.newAgent(row)}
    >
      New agent here
    </DropdownMenu.Item>
    {@render move?.()}
  {/snippet}
  {#snippet opens()}
    <DropdownMenu.Item icon={GitCompare} disabled={row.branch === null || row.missing} onSelect={() => actions.openInGit(row)}>
      Open in Git
    </DropdownMenu.Item>
    <DropdownMenu.Item icon={SquareTerminal} disabled={row.missing || leaving} onSelect={() => actions.openTerminal(row)}>
      Open terminal
    </DropdownMenu.Item>
  {/snippet}
  {#snippet copies()}
    <DropdownMenu.Item icon={Copy} onSelect={() => actions.copyPath(row)}>Copy path</DropdownMenu.Item>
  {/snippet}
</FinishItems>
{#if base !== null}
  <DropdownMenu.Separator />
  <DropdownMenu.Note text={base} />
{/if}
