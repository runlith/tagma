<script lang="ts">
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import MapIcon from '@lucide/svelte/icons/map';
  import Scale from '@lucide/svelte/icons/scale';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import type { Group, Project } from '@tagma/server/graph/contract/wire/rows';
  import { FULL_SHARING, GROUP_SHARES, type GroupShare } from '@tagma/server/projects/contract/wire/project';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { MenuIcon } from '$lib/shared/ui/dropdown-menu/row.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { ProjectGrouping } from './Grouping.svelte.js';

  let { project, group }: { project: Project; group: Group } = $props();

  const grouping = ProjectGrouping.use();
  const notices = Notices.use();

  const SHARES: readonly { readonly share: GroupShare; readonly label: string; readonly icon: MenuIcon }[] = [
    { share: 'map', label: 'Map', icon: MapIcon },
    { share: 'law', label: 'Rules', icon: Scale },
    { share: 'skills', label: 'Skills', icon: Sparkles },
  ];

  const sharing = $derived(group.sharing.find((one) => one.project === project.id) ?? FULL_SHARING);

  const turned = (held: readonly GroupShare[], share: GroupShare, on: boolean) =>
    GROUP_SHARES.filter((one) => (one === share ? on : held.includes(one)));

  function set(side: 'gives' | 'takes', share: GroupShare, on: boolean): void {
    const next = turned(sharing[side], share, on);
    void grouping.share(project, side === 'gives' ? { gives: next } : { takes: next }).catch((error: unknown) => notices.refusal(error));
  }
</script>

<DropdownMenu.Sub>
  <DropdownMenu.SubTrigger icon={ArrowLeftRight}>Sharing</DropdownMenu.SubTrigger>
  <DropdownMenu.SubContent class="min-w-48">
    <DropdownMenu.Label>Gives the group</DropdownMenu.Label>
    {#each SHARES as { share, label, icon } (share)}
      <DropdownMenu.CheckboxItem
        {icon}
        closeOnSelect={false}
        checked={sharing.gives.includes(share)}
        onCheckedChange={(on) => set('gives', share, on)}
      >
        {label}
      </DropdownMenu.CheckboxItem>
    {/each}
    <DropdownMenu.Separator />
    <DropdownMenu.Label>Takes from the group</DropdownMenu.Label>
    {#each SHARES as { share, label, icon } (share)}
      <DropdownMenu.CheckboxItem
        {icon}
        closeOnSelect={false}
        checked={sharing.takes.includes(share)}
        onCheckedChange={(on) => set('takes', share, on)}
      >
        {label}
      </DropdownMenu.CheckboxItem>
    {/each}
  </DropdownMenu.SubContent>
</DropdownMenu.Sub>
