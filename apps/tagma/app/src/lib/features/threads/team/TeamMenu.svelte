<script lang="ts">
  import ArrowUpToLine from '@lucide/svelte/icons/arrow-up-to-line';
  import Bot from '@lucide/svelte/icons/bot';
  import ListTree from '@lucide/svelte/icons/list-tree';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import ScanEye from '@lucide/svelte/icons/scan-eye';
  import User from '@lucide/svelte/icons/user';
  import Users from '@lucide/svelte/icons/users';
  import { Router } from '@runlith/layer/Router';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { ThreadViews } from '../thread/ThreadViews.js';
  import type { ThreadWrites } from '../ThreadWrites.js';
  import ModelsMenu from './ModelsMenu.svelte';
  import ReviewMenu from './ReviewMenu.svelte';
  import { agentsWords, reviewWords } from './words.js';

  let { views, writes }: { views: ThreadViews; writes: ThreadWrites } = $props();

  const router = Router.use();
  const catalog = ProviderCatalog.use();

  const authority = $derived(views.authority);
  const delegation = $derived(authority.delegation);
  const team = $derived(views.team);
  const read = $derived(team?.read);
  const depth = $derived(delegation.depth?.maximum ?? null);
  const teamDiffers = $derived(team?.differs ?? false);
  const delegationOwn = $derived(delegation.own !== null);

  function mode(value: string): void {
    const allowed = value === 'team';
    if (allowed !== delegation.allowed) void writes.applyDelegation(allowed ? 'on' : 'off');
  }

  function reset(): void {
    if (team !== null && teamDiffers) void writes.applyTeam(() => team.reset());
    if (delegationOwn) void writes.applyDelegation('inherit');
  }

  function promote(): void {
    if (team !== null && teamDiffers) void writes.applyTeam(() => team.promote());
    if (delegationOwn) void writes.promoteDelegation();
  }

  function open(key: string): void {
    void router.goto(settingsHref(router, 'agent', 'project', key));
  }
</script>

<DropdownMenu.RadioGroup bind:value={() => (delegation.allowed ? 'team' : 'solo'), mode}>
  <DropdownMenu.RadioItem value="solo" icon={User} title="Works alone" closeOnSelect={false} disabled={authority.busy}>
    Solo
  </DropdownMenu.RadioItem>
  <DropdownMenu.RadioItem value="team" icon={Users} title="May start agents" closeOnSelect={false} disabled={authority.busy}>
    Team
  </DropdownMenu.RadioItem>
</DropdownMenu.RadioGroup>

{#if delegation.allowed}
  <DropdownMenu.Separator />
  {#if depth !== null}
    <DropdownMenu.Item
      icon={ListTree}
      current={String(depth)}
      title="Floors of delegation below the root agent, set for the whole project in Settings"
      onSelect={() => open('agent.subAgentDepth')}
      data-team-go="depth"
    >
      Depth
    </DropdownMenu.Item>
  {/if}
  {#if team !== null && read !== undefined}
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger icon={Bot} current={agentsWords(catalog.models, read.team)} data-team-go="models">
        Agents run on
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent class="w-80">
        <ModelsMenu {team} {writes} onedit={() => open('agent.models')} />
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger icon={ScanEye} current={reviewWords(catalog.models, read.team)} data-team-go="review">
        Reviewed by
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent class="w-80">
        <ReviewMenu {team} {writes} />
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  {/if}
{/if}

{#if teamDiffers || delegationOwn}
  <DropdownMenu.Separator />
  <DropdownMenu.Item icon={RotateCcw} disabled={team?.busy || authority.busy} onSelect={reset}>Reset to project</DropdownMenu.Item>
  <DropdownMenu.Item icon={ArrowUpToLine} disabled={team?.busy || authority.busy} onSelect={promote}>Use for all threads</DropdownMenu.Item>
  <DropdownMenu.Separator />
  <DropdownMenu.Note data-team-differs text="This thread differs from the project." />
{/if}
