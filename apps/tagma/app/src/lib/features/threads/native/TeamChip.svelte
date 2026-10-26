<script lang="ts">
  import User from '@lucide/svelte/icons/user';
  import Users from '@lucide/svelte/icons/users';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import TeamMenu from '../team/TeamMenu.svelte';
  import type { ThreadViews } from '../thread/ThreadViews.js';
  import type { ThreadWrites } from '../ThreadWrites.js';

  let { views, writes }: { views: ThreadViews; writes: ThreadWrites } = $props();

  const delegation = $derived(views.authority.delegation);
  const depth = $derived(delegation.depth);
  const floor = $derived(delegation.allowed === true && depth !== null && depth.remaining === 0);
  const team = $derived(views.team);

  const PILL =
    'inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-meta font-medium transition-colors disabled:opacity-60 [&_svg]:size-3 @min-[30rem]:h-7 @min-[30rem]:gap-1.5 @min-[30rem]:px-2 @min-[30rem]:text-small @min-[30rem]:[&_svg]:size-3.5';
  const TEAM = 'text-muted-foreground hover:bg-hover hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground';
  const SOLO =
    'text-muted-foreground/70 outline-1 -outline-offset-1 outline-dashed outline-border hover:bg-hover hover:text-foreground data-[state=open]:bg-selected';
  const FLOOR = 'bg-severity-gap/10 text-foreground/85 outline-1 -outline-offset-1 outline-severity-gap/35 hover:opacity-80';
</script>

{#if delegation.allowed !== null}
  <DropdownMenu.Root
    onOpenChange={(next) => {
      if (next) team?.refresh();
    }}
  >
    <DropdownMenu.Trigger
      class={[PILL, !delegation.allowed ? SOLO : floor ? FLOOR : TEAM]}
      aria-label={delegation.allowed ? 'Team: agents may start agents' : 'Solo: agents work alone'}
      title={floor && depth !== null ? `This agent stands at depth ${depth.current} of ${depth.maximum}, so its spawn refuses.` : undefined}
      data-team={!delegation.allowed ? 'solo' : floor ? 'floor' : 'team'}
      onpointerdown={(event) => event.preventDefault()}
    >
      {#if delegation.allowed}<Users class="size-3" />{:else}<User class="size-3" />{/if}
      <span class="hidden @min-[22rem]:inline">{delegation.allowed ? 'Team' : 'Solo'}</span>
      {#if floor && depth !== null}
        <span class="font-mono text-meta font-medium text-severity-gap tabular-nums">{depth.current}/{depth.maximum}</span>
      {/if}
      {#if team?.differs || delegation.own !== null}
        <span class="size-1 shrink-0 bg-current opacity-70" data-team-own></span>
      {/if}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content side="top" align="start" class="w-64">
      <TeamMenu {views} {writes} />
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
