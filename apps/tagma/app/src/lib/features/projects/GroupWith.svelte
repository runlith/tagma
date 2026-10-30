<script lang="ts">
  import GroupIcon from '@lucide/svelte/icons/group';
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import Swatch from '$lib/features/workspace/Swatch.svelte';
  import { ProjectGrouping } from './Grouping.svelte.js';

  let { project }: { project: Project } = $props();

  const grouping = ProjectGrouping.use();
  const workspace = Workspace.use();
  const notices = Notices.use();
  const partners = $derived(grouping.partners(project));
</script>

{#if workspace.groups.length > 0 || partners.length > 0}
  <DropdownMenu.Sub>
    <DropdownMenu.SubTrigger icon={GroupIcon}>Group with</DropdownMenu.SubTrigger>
    <DropdownMenu.SubContent class="min-w-48">
      {#each workspace.groups as group (group.graph.id)}
        <DropdownMenu.Item
          icon={GroupIcon}
          onSelect={() => void grouping.join(group, project).catch((error: unknown) => notices.refusal(error))}
        >
          {labelOf(group.graph)}
        </DropdownMenu.Item>
      {/each}
      {#if workspace.groups.length > 0 && partners.length > 0}<DropdownMenu.Separator />{/if}
      {#each partners as partner (partner.id)}
        <DropdownMenu.Item onSelect={() => grouping.ask(project, partner)}>
          {#snippet lead()}<Swatch projectId={partner.id} />{/snippet}
          {labelOf(partner)}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.SubContent>
  </DropdownMenu.Sub>
{/if}
