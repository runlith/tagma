<script lang="ts">
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import Plus from '@lucide/svelte/icons/plus';
  import { Host } from '@runlith/layer/Host';
  import type { Snippet } from 'svelte';
  import { buttonVariants } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import TabRail from '$lib/shared/TabRail.svelte';
  import { cn } from '$lib/shared/utils.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { ContextAim } from '$lib/features/threads/contextAim.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import { chordOf } from './words.js';
  import { ProjectPrefetch } from './Prefetch.js';
  import PulseMarks from './PulseMarks.svelte';
  import { ProjectStrip } from './Strip.svelte.js';
  import { MentionDrops } from '$lib/features/threads/MentionDrops.svelte.js';
  import { mentionOf } from './mention.js';
  import StripMenu from './StripMenu.svelte';
  import Swatch from '$lib/features/workspace/Swatch.svelte';

  let { list }: { list: Snippet } = $props();

  const strip = ProjectStrip.use();
  const drops = MentionDrops.use();
  const prefetch = ProjectPrefetch.use();
  const workspace = Workspace.use();
  const shell = shellActs(ShellOps.use(), Notices.use());
  const host = Host.use();
  const chords = host.isDesktop && host.os === 'macos';
  const aim = new ContextAim();
  let aimed = $state<Project | null>(null);

  const key = (project: Project): string => String(project.id);

  function open(id: string): void {
    const projectId = Number(id);
    if (projectId !== workspace.activeId) void shell.openProject(projectId, 'strip');
  }
</script>

{#snippet face(project: Project, current: boolean)}
  {@const label = labelOf(project)}
  {@const place = strip.projects.indexOf(project)}
  {@const chord = chords ? chordOf(place, strip.projects.length) : null}
  <Tooltip text={label} keys={chord} side="bottom" class="flex min-w-0 flex-1">
    <span
      class="flex min-w-0 flex-1 items-center gap-1.5"
      aria-current={current ? 'page' : undefined}
      data-strip-project={project.id}
      role="presentation"
      onpointerenter={() => prefetch.hover(project)}
      onpointerleave={() => prefetch.leave()}
    >
      <Swatch projectId={project.id} />
      <FadeText class="flex-1" text={label} />
      <PulseMarks projectId={project.id} />
    </span>
  </Tooltip>
{/snippet}

{#snippet more()}
  <DropdownMenu.Root>
    <Tooltip text="All projects">
      <DropdownMenu.Trigger class={cn(buttonVariants({ variant: 'quiet', size: 'icon-sm' }), 'no-drag-region')} aria-label="All projects">
        <Plus class="size-3.5" />
      </DropdownMenu.Trigger>
    </Tooltip>
    <DropdownMenu.Content align="start" class="min-w-64">
      {@render list()}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<div class="drag-region titlebar-inset flex h-(--topbar) shrink-0 items-stretch border-b bg-sunken pr-3">
  <TabRail
    class="flex-1"
    here
    items={strip.projects}
    {key}
    active={workspace.activeId === null ? null : String(workspace.activeId)}
    label="Projects"
    name={labelOf}
    closeLabel={(standing) => `Remove ${labelOf(standing)} from the strip`}
    activate={open}
    close={(id) => strip.remove(Number(id))}
    move={(id, before) => strip.move(Number(id), before === null ? null : Number(before))}
    context={(standing, event) => {
      aimed = standing;
      aim.aim(event);
    }}
    tab={face}
    after={more}
    beyond={drops.beyond((id: string) => {
      const project = strip.projects.find((one) => String(one.id) === id);
      return project === undefined ? null : mentionOf(project);
    })}
  />
</div>

<StripMenu {aim} project={aimed} />
