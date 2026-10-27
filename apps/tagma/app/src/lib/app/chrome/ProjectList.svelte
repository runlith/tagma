<script lang="ts">
  import AppWindow from '@lucide/svelte/icons/app-window';
  import { rank } from '@runlith/search-text/match';
  import Check from '@lucide/svelte/icons/check';
  import FolderMinus from '@lucide/svelte/icons/folder-minus';
  import Network from '@lucide/svelte/icons/network';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import { Host } from '@runlith/layer/Host';
  import { Menu } from '@runlith/primitives/menu.svelte';
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import { chordOf, Keymap, sameChord } from '$lib/app/keys/Keymap.svelte.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import { ProjectPrefetch } from '$lib/features/projects/Prefetch.js';
  import PulseMarks from '$lib/features/projects/PulseMarks.svelte';
  import { ProjectRemoval } from '$lib/features/projects/Removal.svelte.js';
  import { ProjectRenaming } from '$lib/features/projects/Renaming.svelte.js';
  import { ProjectStrip } from '$lib/features/projects/Strip.svelte.js';
  import Swatch from '$lib/features/workspace/Swatch.svelte';
  import { mentionOf } from '$lib/features/projects/mention.js';
  import { MentionDrops } from '$lib/features/threads/MentionDrops.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
  import { Visits } from '$lib/features/workspace/Visits.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { spellChord, spellKey } from '$lib/shared/chordSpelling.js';
  import { cn } from '$lib/shared/utils.js';
  import MatchText from '$lib/shared/MatchText.svelte';
  import { ProjectWindows } from '$lib/shared/desktop/ProjectWindows.js';
  import { ProjectCreation } from './ProjectCreation.svelte.js';
  import { STORAGE } from './projectStorage.js';

  const SEARCH_FROM = 8;
  const RECENT = 4;
  const TEAM_TIP = 'Team: the graph ships with the repository';
  const ACT = 'grid size-5 place-items-center rounded-sm text-muted-foreground';

  const workspace = Workspace.use();
  const shell = shellActs(ShellOps.use(), Notices.use());
  const prefetch = ProjectPrefetch.use();
  const creation = ProjectCreation.use();
  const visits = Visits.use();
  const strip = ProjectStrip.use();
  const removal = ProjectRemoval.use();
  const renaming = ProjectRenaming.use();
  const menu = Menu.use();
  const drops = MentionDrops.use();
  const host = Host.use();
  const keymap = Keymap.use();
  const windows = ProjectWindows.find();
  const newWindowKeys = spellChord({ key: 'Enter', meta: host.apple, ctrl: !host.apple, alt: false, shift: false }, host.apple);
  const removeChord = keymap.mod('Backspace');
  const removeKeys = keymap.spell(removeChord);

  let query = $state('');

  const context = $derived(workspace.contextProject);
  const shared = $derived(workspace.projects.find((project) => project.global) ?? null);
  const projects = $derived(workspace.projects.filter((project) => !project.global));
  const searching = $derived(projects.length >= SEARCH_FROM);
  const needle = $derived(searching ? query.trim().toLocaleLowerCase() : '');
  const found = $derived.by(() => {
    if (needle === '') return [];
    const candidates = shared === null ? projects : [...projects, shared];
    return rank(candidates, needle, (project) => ({ name: labelOf(project), names: [project.name] }));
  });
  const current = $derived(context !== null && !context.global ? context : null);
  const recent = $derived(strip.recent.filter((project) => !project.global && project.id !== current?.id).slice(0, RECENT));
  const rest = $derived(projects.filter((project) => project.id !== current?.id && !recent.includes(project)));

  function open(project: Project, event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target !== null && target.closest('[data-project-remove]') !== null) removal.ask(project);
    else if (windows !== undefined && target !== null && target.closest('[data-new-window]') !== null)
      windows.openProject(visits.resume(project));
    else go(project);
  }

  function go(project: Project): void {
    if (project.id !== workspace.activeId) void shell.openProject(project.id, 'menu');
  }

  function pressed(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
    const act = sameChord(chordOf(event), removeChord)
      ? '[data-project-remove]'
      : event.key === 'Enter' && (event.metaKey || event.ctrlKey)
        ? '[data-new-window]'
        : null;
    if (act === null) return;
    const button = event.currentTarget.querySelector<HTMLElement>(act);
    if (button === null) return;
    event.preventDefault();
    button.click();
  }

  function submit(event: KeyboardEvent): void {
    const first = found[0]?.item;
    if (event.key !== 'Enter' || event.isComposing || first === undefined) return;
    event.preventDefault();
    if (windows !== undefined && (event.metaKey || event.ctrlKey)) windows.openProject(visits.resume(first));
    else go(first);
    menu.close();
  }
</script>

{#snippet row(project: Project, hint: string | null, positions: readonly number[] = [])}
  <DropdownMenu.Item
    onSelect={(event) => open(project, event)}
    onkeydown={pressed}
    onpointerdown={(event: PointerEvent) =>
      drops.press(
        event,
        () => mentionOf(project),
        () => menu.close(),
      )}
    onpointerenter={() => prefetch.hover(project)}
    onpointerleave={() => prefetch.leave()}
    textValue={labelOf(project)}
  >
    {#snippet lead()}
      {#if project.global}<Network class="size-3.5" />{:else}<Swatch projectId={project.id} />{/if}
    {/snippet}
    {#snippet tail()}
      {@const acts = windows !== undefined || !project.global}
      <span class="flex h-5 min-w-5 items-center justify-end">
        <span class={cn('flex items-center', acts && 'group-hover/menu-row:hidden group-data-highlighted/menu-row:hidden')}>
          {#if project.id === context?.id}
            <Check class="size-3.5 text-brand" />
          {:else if hint !== null}
            <Kbd chord={hint} />
          {:else}
            <PulseMarks projectId={project.id} />
          {/if}
        </span>
        {#if acts}
          <span class="hidden items-center gap-0.5 group-hover/menu-row:flex group-data-highlighted/menu-row:flex">
            {#if windows !== undefined}
              <Tooltip text="Open in New Window" keys={newWindowKeys}>
                <button
                  type="button"
                  tabindex="-1"
                  data-new-window
                  aria-label="Open in New Window"
                  class={cn(ACT, 'hover:text-foreground')}
                >
                  <AppWindow class="size-3.5" />
                </button>
              </Tooltip>
            {/if}
            {#if !project.global}
              <Tooltip text="Remove from Tagma…" keys={removeKeys}>
                <button
                  type="button"
                  tabindex="-1"
                  data-project-remove
                  aria-label={`Remove “${labelOf(project)}” from Tagma`}
                  class={cn(ACT, 'hover:text-destructive')}
                >
                  <FolderMinus class="size-3.5" />
                </button>
              </Tooltip>
            {/if}
          </span>
        {/if}
      </span>
    {/snippet}
    <span class="flex min-w-0 items-center gap-1.5">
      <FadeText class="min-w-0"><MatchText text={labelOf(project)} {positions} /></FadeText>
      {#if project.storage === 'team'}
        {@const Team = STORAGE.team.icon}
        <Tooltip text={TEAM_TIP}><Team class="size-3 shrink-0 text-muted-foreground" /></Tooltip>
      {/if}
    </span>
  </DropdownMenu.Item>
{/snippet}

{#if searching}
  <div class="sticky top-0 z-10 -mx-1 -mt-1 mb-1 bg-popover px-1 pt-1">
    <label class="flex h-7 items-center gap-2 rounded-md border bg-field px-2">
      <Search class="size-3.5 shrink-0 text-muted-foreground" />
      <input
        class="min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-muted-foreground"
        placeholder="Find a project"
        aria-label="Find a project"
        autocomplete="off"
        spellcheck="false"
        data-runlith-autofocus
        bind:value={query}
        onkeydown={submit}
      />
    </label>
  </div>
{/if}

{#if needle !== '' || projects.length > 0}
  <div class="-mx-1 max-h-96 overflow-y-auto px-1">
    {#if needle !== ''}
      {#each found as { item: project, hit }, place (project.id)}
        {@render row(project, place === 0 ? spellKey('Enter', host.apple) : null, hit.positions)}
      {:else}
        <DropdownMenu.Note>No project matches</DropdownMenu.Note>
      {/each}
    {:else if searching}
      {#if current !== null}{@render row(current, null)}{/if}
      {#if recent.length > 0}
        <DropdownMenu.Label>Recent</DropdownMenu.Label>
        {#each recent as project (project.id)}{@render row(project, null)}{/each}
        {#if rest.length > 0}<DropdownMenu.Label>All</DropdownMenu.Label>{/if}
      {/if}
      {#each rest as project (project.id)}{@render row(project, null)}{/each}
    {:else}
      {#each projects as project (project.id)}{@render row(project, null)}{/each}
    {/if}
  </div>
  <DropdownMenu.Separator />
{/if}
{#if shared !== null && needle === ''}{@render row(shared, null)}{/if}
<DropdownMenu.Item icon={Plus} onSelect={() => (creation.open = true)}>New project</DropdownMenu.Item>
{#if current !== null}
  <DropdownMenu.Separator />
  <DropdownMenu.Item icon={PencilLine} onSelect={() => renaming.ask(current)}>Rename “{labelOf(current)}”…</DropdownMenu.Item>
  <DropdownMenu.Item variant="destructive" icon={FolderMinus} onSelect={() => removal.ask(current)}>
    Remove “{labelOf(current)}” from Tagma…
  </DropdownMenu.Item>
{/if}
