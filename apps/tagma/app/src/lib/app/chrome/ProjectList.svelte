<script lang="ts">
  import AppWindow from '@lucide/svelte/icons/app-window';
  import { rank } from '@runlith/search-text/match';
  import Check from '@lucide/svelte/icons/check';
  import FolderMinus from '@lucide/svelte/icons/folder-minus';
  import Network from '@lucide/svelte/icons/network';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import { Host } from '@runlith/layer/Host';
  import { Menu } from '@runlith/primitives/menu.svelte';
  import type { Project } from '@tagma/server/graph/contract/wire/rows';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { labelOf } from '$lib/features/workspace/mark.js';
  import { ProjectPrefetch } from '$lib/features/projects/Prefetch.js';
  import PulseMarks from '$lib/features/projects/PulseMarks.svelte';
  import { ProjectRemoval } from '$lib/features/projects/Removal.svelte.js';
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
  import { spellChord, spellKey } from '$lib/shared/chordSpelling.js';
  import { cn } from '$lib/shared/utils.js';
  import MatchText from '$lib/shared/MatchText.svelte';
  import { ProjectWindows } from '$lib/shared/desktop/ProjectWindows.js';
  import { ProjectCreation } from './ProjectCreation.svelte.js';
  import { STORAGE } from './projectStorage.js';

  const SEARCH_FROM = 8;
  const RECENT = 4;

  const workspace = Workspace.use();
  const shell = shellActs(ShellOps.use(), Notices.use());
  const prefetch = ProjectPrefetch.use();
  const creation = ProjectCreation.use();
  const visits = Visits.use();
  const strip = ProjectStrip.use();
  const removal = ProjectRemoval.use();
  const menu = Menu.use();
  const drops = MentionDrops.use();
  const host = Host.use();
  const windows = ProjectWindows.find();
  const newWindowKeys = spellChord({ key: 'Enter', meta: host.apple, ctrl: !host.apple, alt: false, shift: false }, host.apple);

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
    if (windows !== undefined && event.target instanceof Element && event.target.closest('[data-new-window]') !== null)
      windows.openProject(visits.resume(project.name));
    else go(project);
  }

  function go(project: Project): void {
    if (project.id !== workspace.activeId) void shell.openProject(project.id, 'menu');
  }

  function pressed(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    const button = event.currentTarget.querySelector<HTMLElement>('[data-new-window]');
    if (button === null) return;
    event.preventDefault();
    button.click();
  }

  function submit(event: KeyboardEvent): void {
    const first = found[0]?.item;
    if (event.key !== 'Enter' || event.isComposing || first === undefined) return;
    event.preventDefault();
    if (windows !== undefined && (event.metaKey || event.ctrlKey)) windows.openProject(visits.resume(first.name));
    else go(first);
    menu.close();
  }
</script>

{#snippet row(project: Project, hint: string | null, positions: readonly number[] = [])}
  {@const storage = STORAGE[project.storage]}
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
    title={`${storage.label} — ${storage.note}`}
    textValue={labelOf(project)}
  >
    {#snippet lead()}
      {#if project.global}<Network class="size-3.5" />{:else}<Swatch projectId={project.id} />{/if}
    {/snippet}
    {#snippet tail()}
      <span class="relative flex h-5 min-w-5 items-center justify-end">
        <span
          class={cn(
            'flex items-center',
            windows !== undefined && 'group-hover/menu-row:invisible group-data-highlighted/menu-row:invisible',
          )}
        >
          {#if project.id === context?.id}
            <Check class="size-3.5 text-brand" />
          {:else if hint !== null}
            <Kbd chord={hint} />
          {:else}
            <PulseMarks projectId={project.id} />
          {/if}
        </span>
        {#if windows !== undefined}
          <Tooltip text="Open in New Window" keys={newWindowKeys}>
            <button
              type="button"
              tabindex="-1"
              data-new-window
              aria-label="Open in New Window"
              class="invisible absolute inset-y-0 right-0 grid w-5 place-items-center rounded-sm text-muted-foreground group-hover/menu-row:visible group-data-highlighted/menu-row:visible hover:text-foreground"
            >
              <AppWindow class="size-3.5" />
            </button>
          </Tooltip>
        {/if}
      </span>
    {/snippet}
    <MatchText text={labelOf(project)} {positions} />
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

{#if needle !== ''}
  {#each found as { item: project, hit }, place (project.id)}
    {@render row(project, place === 0 ? spellKey('Enter', host.apple) : null, hit.positions)}
  {:else}
    <DropdownMenu.Note>No project matches</DropdownMenu.Note>
  {/each}
{:else}
  {#if shared !== null}
    {@render row(shared, null)}
    {#if projects.length > 0}<DropdownMenu.Separator />{/if}
  {/if}
  {#if searching}
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
{/if}
{#if workspace.projects.length > 0}<DropdownMenu.Separator />{/if}
<DropdownMenu.Item icon={Plus} onSelect={() => (creation.open = true)}>New project</DropdownMenu.Item>
{#if current !== null}
  <DropdownMenu.Separator />
  <DropdownMenu.Item variant="destructive" icon={FolderMinus} onSelect={() => removal.ask(current)}>
    Remove “{labelOf(current)}” from Tagma…
  </DropdownMenu.Item>
{/if}
