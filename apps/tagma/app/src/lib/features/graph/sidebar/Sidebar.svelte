<script lang="ts">
  import { hasTag } from '@tagma/server/graph/contract/wire/tags/roles';
  import { WORK } from '@tagma/server/graph/contract/wire/tags/work';
  import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
  import Search from '@lucide/svelte/icons/search';
  import { Router } from '@runlith/layer/Router';
  import SectionColumn from '$lib/app/panes/SectionColumn.svelte';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
  import { SIDEBAR_SEAM } from '$lib/features/graph/sidebar/seams.js';
  import SidebarRow from '$lib/features/graph/sidebar/SidebarRow.svelte';
  import SidebarShelf from '$lib/features/graph/sidebar/SidebarShelf.svelte';
  import SidebarTree from '$lib/features/graph/sidebar/SidebarTree.svelte';
  import WriterBadge from '$lib/features/graph/WriterBadge.svelte';
  import { ProjectTree } from '$lib/features/graph/ProjectTree.svelte.js';
  import { ReadState } from '$lib/features/graph/ReadState.svelte.js';
  import { SelectionRepo } from '$lib/features/graph/SelectionRepo.js';
  import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
  import { GraphSelection } from '$lib/features/graph/GraphSelection.svelte.js';
  import { refusalOf } from '$lib/wire/refusal.js';
  import { Sidebar as SidebarState } from '$lib/features/graph/sidebar/Sidebar.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { cn } from '$lib/shared/utils.js';

  const projectTree = ProjectTree.use();
  const readState = ReadState.use();
  const selection = SelectionRepo.use();
  const sessions = SessionRegistry.use();
  const graphSelection = GraphSelection.use();
  const sidebar = SidebarState.use();
  const tags = TagCatalog.use();
  const workspace = Workspace.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const surfaces = SurfaceRegistry.use();

  const project = $derived(workspace.contextProject);
  const rows = $derived([...projectTree.blocks.values()]);

  const inWork = $derived(
    rows.filter((row) => tags.standsAt(row, WORK, 'active') && !row.superseded).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const recent = $derived(readState.trailOf.map((name) => projectTree.block(name)).filter((row): row is TreeBlock => row !== undefined));
  const views = $derived(rows.filter((row) => hasTag(row, 'view') && !row.superseded).sort((a, b) => a.title.localeCompare(b.title)));

  let filter = $state('');
  const words = $derived(filter.trim());
  const found = $derived(
    words === '' ? null : selection.search.key({ query: words, projectId: projectTree.aim.projectId, branch: projectTree.aim.branch }),
  );
  const hits = $derived(found?.data ?? null);
  const failure = $derived(found !== null && hits === null && found.error !== undefined ? refusalOf(found.error).reason : null);

  $effect(() => {
    const asked = found;
    return () => void asked?.cancel();
  });

  const scope = $derived(addresses.scope);
  const graphShown = $derived(surfaces.of(router.routeId, router.params) === 'graph');
  const viewLinks = $derived.by(() => {
    if (!project) return [];
    const name = project.name;
    const opened = graphShown ? (graphSelection.name ?? scope) : scope;
    return [
      {
        label: 'Tree',
        href: opened === null ? addresses.project(name) : addresses.block(opened, { project: name }),
        active: !graphShown,
      },
      {
        label: 'Graph',
        href: scope === null ? addresses.project(name, 'graph') : addresses.scoped('graph', scope, name),
        active: graphShown,
      },
    ];
  });

  function onFilterKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || filter === '') return;
    event.preventDefault();
    filter = '';
  }
</script>

<SectionColumn
  geometry={SIDEBAR_SEAM}
  label="Knowledge"
  resize="Resize the knowledge column"
  onCollapse={() => sidebar.toggle()}
  class="overflow-y-auto pb-10 [scrollbar-gutter:stable]"
>
  {#if project}
    <div class="sticky top-0 z-10 grid gap-2 bg-chrome px-3 pt-3 pb-1">
      <nav class="flex rounded-md border bg-sunken p-0.5" aria-label="Knowledge view">
        {#each viewLinks as link (link.label)}
          <a
            href={link.href}
            aria-current={link.active ? 'page' : undefined}
            class={cn(
              'flex-1 rounded-sm px-2 py-0.5 text-center text-small transition-colors',
              link.active ? 'bg-selected text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {link.label}
          </a>
        {/each}
      </nav>
      <div class="relative">
        <Search class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          bind:value={filter}
          type="search"
          placeholder="Filter blocks"
          aria-label="Filter blocks"
          class="w-full rounded-md border bg-transparent py-1 pr-2 pl-8 text-ui outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring"
          onkeydown={onFilterKeydown}
        />
      </div>
    </div>

    {#if words !== ''}
      <section class="px-3 pt-3" aria-label="Matching blocks">
        {#if failure !== null}
          <p class="px-1 text-small text-destructive">The search failed: {failure}</p>
        {:else if hits === null}
          <p class="px-1 text-small text-muted-foreground">Searching…</p>
        {:else if hits.items.length === 0}
          <p class="px-1 text-small text-muted-foreground">Nothing matches “{words}”.</p>
        {:else}
          <div class="eyebrow flex items-baseline gap-2 px-1 pb-1 text-muted-foreground">
            <span>{hits.approximate ? 'Close spellings' : 'Matches'}</span>
            <span class="stamp tabular ml-auto text-muted-foreground/60">
              {hits.total > hits.items.length ? `${hits.items.length} of ${hits.total}` : hits.total}
            </span>
          </div>
          {#each hits.items as block (block.name)}
            <SidebarRow {block} project={project.name} />
          {/each}
        {/if}
      </section>
    {:else}
      <SidebarShelf heading="In work" blocks={inWork} project={project.name}>
        {#snippet badge(block)}
          {#if tags.holderOf(block) !== null}
            <WriterBadge writer={sessions.writerOf(tags.holderOf(block))} label={false} />
          {/if}
        {/snippet}
      </SidebarShelf>
      <SidebarShelf heading="Recent" blocks={recent} project={project.name} />
      <SidebarTree project={project.name} />
      <SidebarShelf heading="Views" blocks={views} project={project.name} />
    {/if}
  {/if}
</SectionColumn>
