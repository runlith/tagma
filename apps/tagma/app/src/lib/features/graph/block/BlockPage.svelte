<script lang="ts">
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import Folder from '@lucide/svelte/icons/folder';
  import X from '@lucide/svelte/icons/x';
  import { untrack, type Snippet } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import { currentBranch, diffLensHref, diffRangeOf } from '$lib/features/workspace/address.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import type { BlockDiff, BlockMark } from '@tagma/server/graph/contract/wire/reads';
  import type { Block, BlockRead, TreeBlock } from '@tagma/server/graph/contract/wire/rows';
  import { LEAF } from '@tagma/server/graph/contract/wire/tags/leaf';
  import { SPEC } from '@tagma/server/graph/contract/wire/tags/spec';
  import { WORK } from '@tagma/server/graph/contract/wire/tags/work';
  import { toldOf } from '$lib/wire/refusal.js';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
  import AbsentBlock from '$lib/features/graph/AbsentBlock.svelte';
  import TrashedBlock from '$lib/features/graph/TrashedBlock.svelte';
  import UnreadableBlock from '$lib/features/graph/UnreadableBlock.svelte';
  import BlockActionsMenu from '$lib/features/graph/outline/BlockActionsMenu.svelte';
  import BlockBody from '$lib/features/graph/block/Body.svelte';
  import BlockDiffCard from '$lib/features/graph/BlockDiffCard.svelte';
  import BlockName from '$lib/features/graph/BlockName.svelte';
  import FilterBar from '$lib/features/graph/FilterBar.svelte';
  import { codeParts } from '$lib/shared/codeParts.js';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import MarkdownBody from '$lib/features/graph/MarkdownBody.svelte';
  import Outline from '$lib/features/graph/outline/Tree.svelte';
  import BlockFacts from '$lib/features/graph/block/BlockFacts.svelte';
  import BlockLinks, { hasLinks } from '$lib/features/graph/block/BlockLinks.svelte';
  import StatusChip from '$lib/features/graph/StatusChip.svelte';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import ViewResults from '$lib/features/graph/block/ViewResults.svelte';
  import WriterBadge from '$lib/features/graph/WriterBadge.svelte';
  import { JournalLive } from '$lib/features/graph/journal/Live.svelte.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { ReadState } from '$lib/features/graph/ReadState.svelte.js';
  import { Visits } from '$lib/features/workspace/Visits.svelte.js';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { GraphFeed } from '$lib/features/graph/Feed.js';
  import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
  import { LinksPlacement } from './LinksPlacement.svelte.js';
  import { Subject } from './Subject.svelte.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { timeAgo } from '$lib/shared/time.js';
  import { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { directoryLink, fileLink } from '$lib/features/checkout/links.js';
  import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
  import { PathRoads } from '$lib/features/checkout/PathRoads.js';
  import { blockLink } from '$lib/features/graph/links.js';
  import type { Link } from '$lib/features/opening/Link.js';
  import { linkTarget, linkWithin } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import type { PathRoad } from '$lib/features/opening/PathLinks.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { cn } from '$lib/shared/utils.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import PathText from '$lib/shared/PathText.svelte';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import Trail from '$lib/shared/Trail.svelte';

  let {
    blockName,
    enforcement,
    aside = false,
    diff = null,
    read: shown = $bindable(null),
  }: {
    blockName?: string;
    enforcement?: Snippet<[BlockRead]>;
    aside?: boolean;
    diff?: string | null;
    read?: BlockRead | null;
  } = $props();

  let lensAt = $state(untrack(() => diff));
  const lensParam = (): string | null => (aside ? lensAt : router.url.searchParams.get('diff'));

  const blockTitles = BlockTitles.use();
  const commitLinks = CommitLinks.use();
  const journalLive = JournalLive.use();
  const notices = Notices.use();
  const readState = ReadState.use();
  const sessions = SessionRegistry.use();
  const links = LinksPlacement.use();
  const visits = Visits.use();
  const workspace = Workspace.use();
  const blocks = BlocksRepo.use();
  const feed = GraphFeed.use();
  const tags = TagCatalog.use();
  const router = Router.use();
  const addresses = Addresses.use();
  const opening = Opening.use();
  const checkout = Checkout.use();
  const graph = GraphRung.Current.use();
  const here = App.current();
  const roads = PathRoads.use();
  let crumbModified = false;
  const pathRoot = $derived(checkout.row?.rootId);
  const paths = $derived<PathRoad>(roads.road({ project: graph.projectId }, { root: pathRoot }));
  function sourceLink(kind: string, ref: string): Link | null {
    const row = checkout.row;
    if (kind !== 'dir') return fileLink({ path: ref, root: row?.rootId }, { project: graph.projectId });
    if (row === null) return null;
    const place = { projectId: graph.projectId, checkout: row.rootId, root: row.path, path: ref };
    return directoryLink({ absolute: `${row.path}/${ref}`, place }, { project: graph.projectId });
  }
  // svelte-ignore state_referenced_locally
  const store = TreeScreen.mount(blockName === undefined ? { reading: 'outline' } : { reading: 'block', root: blockName });

  const subject = new Subject(store, blocks, feed, tags, notices);
  const read = $derived(subject.read);
  const rootBlock = $derived<TreeBlock | undefined>(subject.root ?? (read !== null && read.name === store.rootName ? read : undefined));
  const unavailable = $derived(subject.unavailable);
  const placed = $derived(subject.root !== undefined || store.rootAbsent);
  const readProject = $derived(read?.projectId);

  $effect.pre(() => {
    shown = read;
  });

  $effect(() => {
    if (aside) return;
    const name = blockName;
    const project = untrack(() => workspace.active);
    const branch = untrack(() => currentBranch(router));
    if (project === null) return;
    if (name === undefined) {
      visits.remember(project, 'outline', null, branch);
      return;
    }
    const projectId = readProject;
    if (projectId === undefined) return;
    if (projectId === project.id) {
      visits.remember(project, 'outline', name, branch);
      return;
    }
    let disposed = false;
    void workspace
      .nameOf(projectId)
      .then(async (owner) => {
        if (disposed) return;
        await router.goto(addresses.block(name, { project: owner }), { replaceState: true });
      })
      .catch((error: unknown) => {
        if (!disposed) notices.refusal(error);
      });
    return () => {
      disposed = true;
    };
  });

  const reading = $derived(read === null ? null : tags.readingOf(read));

  let baseline = $state<string | undefined>(undefined);
  let arrived: string | null = null;

  $effect(() => {
    const current = rootBlock;
    if (!current) return;
    if (arrived !== current.name) {
      arrived = current.name;
      baseline = untrack(() => readState.seenAt(current.name));
      if (blockName !== undefined) readState.visited(current.name);
    }
    readState.markRead(current.name, current.updatedAt);
  });

  const ancestors = $derived.by(() => {
    if (!rootBlock) return [] as TreeBlock[];
    const chain: TreeBlock[] = [];
    let cursor = rootBlock.parentName;
    while (cursor !== null) {
      const parent = store.block(cursor);
      if (!parent) break;
      chain.unshift(parent);
      cursor = parent.parentName;
    }
    return chain;
  });

  function crumbHref(block: TreeBlock): string {
    return block.parentName === null ? addresses.surface('outline') : addresses.block(block.name);
  }

  function crumbTitle(block: TreeBlock): string {
    return block.title.trim() || 'Untitled';
  }

  const blockOf = (name: string): Link => blockLink({ name, copy: store.block(name) === undefined ? undefined : graph });

  const blockAt = (element: HTMLElement): Link | null => {
    const { block: name, project, branch } = element.dataset;
    if (name === undefined) return null;
    return project === undefined ? blockOf(name) : blockLink({ name, copy: { projectId: Number(project), branch: branch ?? null } });
  };

  const hasConnectivity = $derived(read !== null && (hasLinks(read, store) || read.sources.length > 0));
  const linksBeside = $derived(links.placement === 'side');

  const diffRange = $derived(diffRangeOf(lensParam()));
  let lens = $state<{ diff: BlockDiff; marks: readonly BlockMark[]; blocks: readonly Block[] } | null>(null);
  let lensFailure = $state<unknown>(null);
  let lensQuestion: string | null = null;
  const lensSettled = $derived(diffRange === null || lens !== null || lensFailure !== null);
  let appeared = $state(false);

  $effect.pre(() => {
    if (rootBlock !== undefined && read !== null && lensSettled) appeared = true;
  });

  const lensAvailable = $derived(
    diffRange !== null || (baseline !== undefined && rootBlock !== undefined && baseline < rootBlock.updatedAt),
  );

  const filterable = $derived(
    lensAvailable ||
      store.readingLens.active ||
      store.readingLens.sortMode !== 'manual' ||
      (store.rootName !== null && store.children(store.rootName).length > 0),
  );

  $effect(() => {
    const range = diffRange;
    const current = store;
    const root = rootBlock;
    if (root === undefined || range === null) {
      current.clearLens();
      lens = null;
      lensFailure = null;
      lensQuestion = null;
      return;
    }
    current.lensReturn = lensParam();
    lensFailure = null;
    let cancelled = false;
    const seen = range.kind === 'read' ? baseline : undefined;
    const asked =
      range.kind === 'range'
        ? { from: range.from, to: range.to ?? undefined }
        : seen !== undefined
          ? { since: seen }
          : { from: journalLive.seenId };
    const question = JSON.stringify({ name: root.name, ...asked });
    if (question !== lensQuestion) {
      lensQuestion = question;
      lens = null;
    }
    void blocks.diff
      .key({ name: root.name, ...asked })
      .refresh({ throwOnError: true })
      .then((result) => {
        if (cancelled || !result) return;
        lens = result;
        current.setLens(result.marks, result.blocks);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        lens = null;
        lensFailure = error;
      });
    return () => {
      cancelled = true;
      current.clearLens();
    };
  });

  $effect(() => {
    const currentId = store.rootName;
    if (currentId == null) return;
    return feed.frames((event) => {
      if (event.type !== 'change' || diffRangeOf(lensParam()) !== null) return;
      if (event.blocks.some((row) => row.name === currentId && row.deletedAt !== null)) return;
      const foreign = event.events.find((entry) => entry.blockName === currentId && entry.sessionId !== null);
      if (foreign === undefined) return;
      if (aside) lensAt = `${foreign.id - 1}..`;
      else void router.goto(diffLensHref(router, `${foreign.id - 1}..`), { replaceState: true, noScroll: true, keepFocus: true });
    });
  });

  let titleEl = $state<HTMLDivElement | null>(null);
  let editingTitle = $state(false);

  $effect(() => {
    const el = titleEl;
    const title = rootBlock?.title ?? '';
    if (!el || editingTitle || el.dataset.shown === title) return;
    el.dataset.shown = title;
    el.replaceChildren(
      ...codeParts(title).map((part) => {
        if (!part.code) return document.createTextNode(part.text);
        const code = document.createElement('code');
        code.className = 'rounded-sm bg-selected px-1 font-mono';
        code.textContent = part.text;
        return code;
      }),
    );
  });

  function editTitle(): void {
    editingTitle = true;
    const el = titleEl;
    const title = rootBlock?.title ?? '';
    if (!el) return;
    delete el.dataset.shown;
    if (!codeParts(title).some((part) => part.code)) return;
    el.textContent = title;
    const caret = document.createRange();
    caret.selectNodeContents(el);
    caret.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(caret);
  }

  function commitTitle(): void {
    const title = titleEl?.textContent ?? '';
    if (store.rootName != null && rootBlock !== undefined && title !== rootBlock.title) void store.rename(store.rootName, title);
  }

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  function copyName(name: string): void {
    void navigator.clipboard.writeText(`[[${name}]]`);
    copied = true;
    if (copiedTimer !== null) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied = false;
    }, 1200);
  }
</script>

{#if unavailable?.kind === 'absent'}
  <AbsentBlock name={unavailable.name} />
{:else if unavailable?.kind === 'trashed'}
  <TrashedBlock name={unavailable.name} {store} restored={() => subject.retry()} />
{:else if unavailable?.kind === 'failed'}
  <UnreadableBlock error={unavailable.error} retry={() => subject.retry()} />
{:else if rootBlock && read && (appeared || lensSettled)}
  <div
    class={cn(
      'page-reading grid grid-cols-1 gap-x-8 pt-8 pb-16',
      linksBeside && '@rail/page:max-w-none @rail/page:grid-cols-[minmax(0,1fr)_46rem_minmax(0,1fr)]',
    )}
    {@attach aside && linkWithin(opening, 'a[data-block]', blockAt, here)}
  >
    <div class={cn('min-w-0', linksBeside && '@rail/page:col-start-2')}>
      {#if ancestors.length > 0}
        <Trail steps={ancestors} class="mb-3 text-small text-muted-foreground">
          {#snippet step(block)}
            <a href={crumbHref(block)} data-block={block.name} class="block transition-colors hover:text-foreground">
              <FadeText text={crumbTitle(block)} />
            </a>
          {/snippet}
          {#snippet folded(blocks)}
            <DropdownMenu.Root>
              <Tooltip text="Show the levels in between">
                <DropdownMenu.Trigger
                  class="rounded-sm px-1 leading-none transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-selected data-[state=open]:text-foreground"
                  aria-label="Show the levels in between"
                >
                  …
                </DropdownMenu.Trigger>
              </Tooltip>
              <DropdownMenu.Content align="start" class="min-w-56">
                {#each blocks as block (block.name)}
                  <DropdownMenu.Item
                    onpointerup={(event: PointerEvent) => (crumbModified = opening.modified(event))}
                    onkeydown={(event: KeyboardEvent) => (crumbModified = opening.modified(event))}
                    onSelect={() =>
                      void (aside ? opening.open(blockOf(block.name), opening.how(crumbModified), here) : router.goto(crumbHref(block)))}
                  >
                    {#snippet lead()}<TagIcon tag={tags.tagOf(block)} class="size-3.5" />{/snippet}
                    {crumbTitle(block)}
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/snippet}
        </Trail>
      {:else if rootBlock.parentName !== null && !placed}
        <div class="mb-3 text-small" aria-hidden="true">&nbsp;</div>
      {/if}

      <div
        bind:this={titleEl}
        class="title text-title outline-none"
        contenteditable="true"
        spellcheck="false"
        role="textbox"
        aria-label="Title"
        tabindex="0"
        data-placeholder="Untitled"
        onfocus={editTitle}
        onblur={() => {
          commitTitle();
          editingTitle = false;
        }}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            titleEl?.blur();
          }
        }}
      ></div>

      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="flex items-center gap-1.5 text-muted-foreground">
          <TagIcon tag={rootBlock.parentName === null ? 'project' : tags.tagOf(rootBlock)} class="size-3.5" />
          <span class="eyebrow capitalize">{rootBlock.parentName === null ? 'project' : tags.word(tags.tagOf(rootBlock))}</span>
        </span>
        <StatusChip block={rootBlock} {store} always />
        {#if tags.supports(rootBlock, WORK) || tags.supports(rootBlock, SPEC)}
          {#if tags.holderOf(rootBlock) !== null}
            <WriterBadge writer={sessions.writerOf(tags.holderOf(rootBlock))} />
          {:else if read.ending}
            <WriterBadge writer={read.ending.writer} />
          {/if}
        {/if}
        {#if reading}
          <Tooltip text="The system this reading measured, and which state of it">
            <span class="stamp tabular text-muted-foreground/70">
              source {reading.name} @ {reading.ref}
            </span>
          </Tooltip>
        {/if}

        <span class="h-3.5 w-px bg-border"></span>

        <Tooltip text="Copy the writing-canon name">
          <button
            type="button"
            class="group/copy flex items-center gap-1.5 rounded-sm text-muted-foreground/70 transition-colors hover:text-foreground"
            onclick={() => copyName(rootBlock.name)}
          >
            <BlockName name={rootBlock.name} class="text-inherit" />
            {#if copied}
              <Check class="size-3 text-status-done" />
            {:else}
              <Copy class="size-3 opacity-45 transition-opacity group-hover/copy:opacity-100" />
            {/if}
          </button>
        </Tooltip>

        <span class="stamp tabular text-muted-foreground/70">updated {timeAgo(rootBlock.updatedAt)}</span>

        <BlockActionsMenu
          block={rootBlock}
          {store}
          author={sessions.writerOf(read.author)}
          linksPlacement={hasConnectivity ? { beside: linksBeside, toggle: () => links.toggle() } : undefined}
          triggerClass="ml-auto"
          onDeleted={aside
            ? undefined
            : (parentName) => void router.goto(parentName === null ? addresses.surface('outline') : addresses.block(parentName))}
        />
      </div>

      <div class="mt-4 border-t border-vein pt-1"></div>

      {#if diffRange}
        <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-brand/35 bg-brand/5 px-3 py-2">
          <span class="eyebrow shrink-0 text-brand">Diff</span>
          {#if lens}
            {#each lens.diff.sessions as sessionId (sessionId)}
              <WriterBadge writer={sessions.writerOf(sessionId)} />
            {/each}
            <span class="text-small text-muted-foreground">
              {#if lens.diff.entries > 0}
                {lens.diff.entries}
                {lens.diff.entries === 1 ? 'entry' : 'entries'} · {lens.diff.ops.join(', ')}
              {:else if lens.marks.length > 0}
                {lens.marks.length}
                {lens.marks.length === 1 ? 'block' : 'blocks'} changed below
              {:else}
                Nothing has changed since you last read this
              {/if}
            </span>
          {:else if lensFailure !== null}
            <span class="text-small text-destructive">Could not read the journal back: {toldOf(lensFailure).text}</span>
          {:else}
            <span class="text-small text-muted-foreground">Reading the journal back…</span>
          {/if}
          {#snippet current()}<X class="size-3" />Show the current version{/snippet}
          {#if aside}
            <button
              type="button"
              class="ml-auto flex items-center gap-1 text-small text-muted-foreground transition-colors hover:text-foreground"
              onclick={() => (lensAt = null)}>{@render current()}</button
            >
          {:else}
            <a
              href={router.pathname}
              class="ml-auto flex items-center gap-1 text-small text-muted-foreground transition-colors hover:text-foreground"
              >{@render current()}</a
            >
          {/if}
        </div>
      {/if}

      {#if diffRange}
        <div class="mt-4">
          {#if lens}
            <BlockDiffCard diff={lens.diff} body={read.body} />
          {:else}
            <MarkdownBody text={read.body} refs={blockTitles} commits={commitLinks} {paths} />
          {/if}
        </div>
      {:else}
        <BlockBody {store} body={read.body} {paths} />
      {/if}

      <BlockFacts {read} {enforcement} />

      {#if placed}
        {#if tags.supports(rootBlock, LEAF)}
          {@const query = tags.queryOf(read)}
          {#if read.results && query}
            <div class="mt-8 border-t border-vein pt-2">
              <ViewResults block={read} {query} results={read.results} lens={store.readingLens} />
            </div>
          {/if}
        {:else}
          <div class="mt-8 border-t border-vein pt-2">
            {#if filterable}<FilterBar lens={store.readingLens} {store} diff={lensAvailable && !aside} />{/if}
          </div>
          <div class="mt-1">
            <Outline {store} />
          </div>
        {/if}
      {/if}
    </div>

    {#if placed && hasConnectivity}
      <aside
        class={cn(
          'mt-12 grid content-start gap-8',
          linksBeside &&
            '@rail/page:sticky @rail/page:top-8 @rail/page:col-start-3 @rail/page:row-start-1 @rail/page:mt-0 @rail/page:w-60 @rail/page:self-start @rail/page:max-h-[calc(100svh-var(--topbar)-4rem)] @rail/page:overflow-y-auto',
        )}
      >
        <BlockLinks {read} {store} beside={linksBeside} unlinked={() => subject.retry()} />

        {#if read.sources.length > 0}
          <section>
            <h2 class="eyebrow text-muted-foreground">Sources</h2>
            <div class={cn('mt-2 grid gap-1 gap-x-8 sm:grid-cols-2', linksBeside && '@rail/page:grid-cols-1')}>
              {#each read.sources as source (source.id)}
                {#snippet face()}
                  {#if source.kind === 'dir'}
                    <Folder class="mt-px size-3.5 shrink-0 text-muted-foreground" />
                  {:else}
                    <FileIcon path={source.ref} class="mt-px" />
                  {/if}
                  <span class="grid min-w-0 flex-1">
                    <PathText class="stamp" path={source.ref} directoryClass="text-muted-foreground" />
                    {#if source.symbol}
                      <FadeText class="stamp text-muted-foreground" text={source.symbol} />
                    {/if}
                  </span>
                {/snippet}
                <button
                  type="button"
                  class="flex min-w-0 items-start gap-1.5 rounded-md text-left transition-colors hover:text-foreground"
                  data-source={source.ref}
                  {@attach linkTarget(opening, () => sourceLink(source.kind, source.ref), here)}
                >
                  {@render face()}
                </button>
              {/each}
            </div>
          </section>
        {/if}
      </aside>
    {/if}
  </div>
{:else}
  <div class="pending grid h-full place-items-center">
    <Waiting class="size-4 text-muted-foreground" label="Reading the block" />
  </div>
{/if}

<style>
  .pending {
    animation: reveal 0s 400ms backwards;
  }

  @keyframes reveal {
    from {
      opacity: 0;
    }
  }

  .title:empty::before {
    content: attr(data-placeholder);
    color: var(--muted-foreground);
    opacity: 0.5;
    pointer-events: none;
  }
</style>
