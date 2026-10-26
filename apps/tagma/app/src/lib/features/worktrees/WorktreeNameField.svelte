<script lang="ts">
  import { worktreeBranchPrefix } from '@tagma/server/worktrees/contract/wire/settings';
  import type { KeyboardEventHandler } from 'svelte/elements';
  import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
  import * as InputGroup from '$lib/shared/ui/input-group/index.js';
  import { Worktrees } from './BoardState.svelte.js';

  let {
    value = $bindable(''),
    placeholder,
    label = 'Branch name',
    size = 'md',
    onkeydown,
  }: {
    value?: string;
    placeholder: string;
    label?: string;
    size?: 'sm' | 'md';
    onkeydown?: KeyboardEventHandler<HTMLInputElement>;
  } = $props();

  const worktrees = Worktrees.use();
  const settings = SettingsRepo.use();

  const prefix = $derived.by(() => {
    const entry = settings.catalog.key(worktrees.aim.projectId).data?.entries.find((row) => row.id === worktreeBranchPrefix.id);
    return typeof entry?.value === 'string' ? entry.value : worktreeBranchPrefix.fallback;
  });
  const shown = $derived(prefix !== '' && !value.trim().startsWith(prefix));
</script>

<InputGroup.Root class={size === 'sm' ? 'h-7' : 'h-8'}>
  {#if shown}
    <InputGroup.Addon class="pr-0 font-mono text-small font-normal">{prefix}</InputGroup.Addon>
  {/if}
  <InputGroup.Input
    bind:value
    {placeholder}
    {onkeydown}
    aria-label={label}
    class="h-full px-0.5 font-mono text-small placeholder:text-muted-foreground/60"
    autocomplete="off"
    spellcheck={false}
    data-worktree-name
  />
</InputGroup.Root>
