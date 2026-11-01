<script lang="ts">
  import Bot from '@lucide/svelte/icons/bot';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import TerminalIcon from '../TerminalIcon.svelte';
  import type { WorktreeTerminals } from '../worktrees/WorktreeTerminals.svelte.js';
  import { confirmsComposition } from './PaneTitle.svelte';
  import type { TerminalTab } from './Tab.svelte.js';

  let { worktree, tab }: { worktree: WorktreeTerminals; tab: TerminalTab } = $props();

  const addresses = Addresses.use();
  const workspace = Workspace.use();
  const project = $derived(workspace.find(worktree.projectId));
  const renaming = $derived(worktree.renaming === tab.key);
  const adopter = $derived(worktree.adopterOf(tab));

  let draft = $state('');
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!renaming) return;
    draft = worktree.titleOf(tab);
    input?.focus();
    input?.select();
  });

  function commit(): void {
    if (worktree.renaming !== null) worktree.commitRename(draft);
  }

  function onKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (confirmsComposition(event)) return;
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      worktree.cancelRename();
    }
  }
</script>

{#if adopter !== null}
  <Tooltip text={`Thread “${adopter.label}” runs its CLI in this terminal — open the thread`} class="flex shrink-0 items-center">
    <a
      class="text-muted-foreground hover:text-foreground"
      href={project === null ? undefined : addresses.thread(adopter.thread, project.name)}
      aria-label={`Open thread ${adopter.label}`}
      data-tab-adopter={adopter.thread}
      onpointerdown={(event) => event.stopPropagation()}
    >
      <Bot class="size-3.5" />
    </a>
  </Tooltip>
{:else}
  <TerminalIcon class="size-3.5 shrink-0" />
{/if}
{#if renaming}
  <input
    bind:this={input}
    bind:value={draft}
    class="min-w-0 flex-1 rounded-sm border bg-transparent px-1 text-small outline-none"
    aria-label="Tab name"
    onclick={(event) => event.stopPropagation()}
    onpointerdown={(event) => event.stopPropagation()}
    onkeydown={onKey}
    onblur={commit}
  />
{:else}
  <FadeText class="flex-1" text={worktree.titleOf(tab) || 'Terminal'} ondblclick={() => worktree.beginRename(tab.key)} />
{/if}
{#if tab.attention}
  <span class="size-1.5 shrink-0 bg-status-in-work" role="img" aria-label="The terminal rang"></span>
{:else if tab.status === 'lost'}
  <span class="size-1.5 shrink-0 bg-destructive" role="img" aria-label="The terminal was lost"></span>
{/if}
