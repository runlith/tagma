<script lang="ts">
  import { worktreeBranchPrefix } from '@tagma/server/worktrees/contract/wire/settings';
  import { namedBranch } from '@tagma/server/worktrees/contract/wire/creation';
  import { untrack } from 'svelte';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { Button } from '$lib/shared/ui/button/index.js';
  import * as Dialog from '$lib/shared/ui/dialog/index.js';
  import * as Select from '$lib/shared/ui/select/index.js';
  import { Worktrees } from './BoardState.svelte.js';
  import WorktreeNameField from './WorktreeNameField.svelte';
  import WorktreeSwatch from './WorktreeSwatch.svelte';

  let {
    open = $bindable(false),
    from = null,
    suggested = '',
    onCreated,
  }: { open?: boolean; from?: string | null; suggested?: string; onCreated?: (branch: string) => void } = $props();

  const worktrees = Worktrees.use();
  const settings = SettingsRepo.use();
  const workspace = Workspace.use();
  const project = $derived(workspace.find(worktrees.aim.projectId)?.name ?? String(worktrees.aim.projectId));

  const prefix = $derived.by(() => {
    const entry = settings.catalog.key(worktrees.aim.projectId).data?.entries.find((row) => row.id === worktreeBranchPrefix.id);
    return typeof entry?.value === 'string' ? entry.value : worktreeBranchPrefix.fallback;
  });

  const bases = $derived(worktrees.rows.filter((row) => row.branch !== null && !row.missing));

  let name = $state('');
  let automatic = $state('');
  let start = $state('');

  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = suggested;
      automatic = `worktree-${crypto.randomUUID().replaceAll('-', '').slice(0, 6)}`;
      start = from ?? worktrees.main?.branch ?? bases[0]?.branch ?? '';
    });
  });

  const chosen = $derived(bases.find((row) => row.branch === start) ?? null);
  const branch = $derived(namedBranch(prefix, name.trim() === '' ? automatic : name));
  const named = $derived(branch !== '' && branch !== prefix && !branch.endsWith('/'));

  function submit(): void {
    if (!named || start === '') return;
    const wanted = branch;
    open = false;
    void worktrees.create(wanted, start).then((rootId) => {
      if (rootId !== null) onCreated?.(wanted);
    });
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="text-page">New worktree in {project}</Dialog.Title>
      <Dialog.Description>A checkout on its own branch. Agents started in it write nowhere else.</Dialog.Description>
    </Dialog.Header>
    <form
      class="grid gap-3"
      onsubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div class="grid gap-1.5" data-new-worktree-branch>
        <span class="eyebrow text-muted-foreground">Name</span>
        <WorktreeNameField bind:value={name} placeholder={automatic} />
      </div>
      <div class="grid gap-1.5">
        <span class="eyebrow text-muted-foreground">Start from</span>
        <Select.Root value={start} onValueChange={(picked) => (start = picked)}>
          <Select.Trigger class="w-full" aria-label="Start from">
            <span class="flex min-w-0 items-center gap-2">
              {#if chosen !== null}<WorktreeSwatch row={chosen} />{/if}
              <span class="min-w-0 truncate font-mono text-small text-foreground">{start}</span>
            </span>
          </Select.Trigger>
          <Select.Content>
            {#each bases as row (row.rootId)}
              <Select.Item value={row.branch ?? ''} label={row.branch ?? row.name}>
                <span class="flex min-w-0 flex-1 items-center gap-2">
                  <WorktreeSwatch {row} />
                  <span class="min-w-0 truncate font-mono text-small">{row.branch}</span>
                </span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <p class="text-small leading-relaxed text-muted-foreground">
        The folder is made in the project's worktree folder, named after the branch.
      </p>
      <Dialog.Footer>
        <Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
        <Button type="submit" disabled={!named || start === ''}>Create worktree</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
