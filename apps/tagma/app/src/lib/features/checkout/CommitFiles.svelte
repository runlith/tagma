<script lang="ts">
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import type { Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import type { ComparedPath } from '@tagma/server/workspace/contract/wire/checkout';
  import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import type { CommitReading } from '@tagma/server/workspace/contract/wire/history';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { commitLink } from './links.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { CheckoutRepo } from './Repo.js';
  import ChangeList from './ChangeList.svelte';
  import { insetOf } from './changeItem.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import ReadingFailed from '$lib/shared/ReadingFailed.svelte';
  import { SHORT_SHA } from './reading.js';

  let {
    projectId,
    rootId,
    commit,
    author,
    thread,
    grouped,
    selected,
    gitLink = false,
    heading = true,
    depth = 1,
    onOpen,
    onKeep,
    link,
    aside,
  }: {
    projectId: number;
    rootId: RootId;
    commit: string;
    author?: string | undefined;
    thread?: string | undefined;
    grouped: boolean;
    selected: string | null;
    gitLink?: boolean;
    heading?: boolean;
    depth?: number;
    onOpen?: ((file: ComparedPath) => void) | undefined;
    onKeep?: ((file: ComparedPath) => void) | undefined;
    link?: ((file: ComparedPath) => Attachment<HTMLElement>) | undefined;
    aside?: Snippet<[ComparedPath]> | undefined;
  } = $props();

  const inset = $derived(`${insetOf(depth)}px`);

  const repo = CheckoutRepo.use();
  const workspace = Workspace.use();
  const addresses = Addresses.use();
  const opening = Opening.use();
  const here = App.current();
  const home = $derived(workspace.find(projectId)?.name);

  const aim = $derived(`${projectId}\u0000${rootId}\u0000${commit}\u0000${thread ?? ''}`);

  let paged = $state<{ readonly aim: string; readonly files: readonly ComparedPath[]; readonly cursor: string } | null>(null);
  const earlier = $derived(paged?.aim === aim ? paged : null);

  const query = $derived(
    repo.commitReading.key({
      projectId,
      rootId,
      commit,
      thread,
      cursor: earlier === null ? undefined : earlier.cursor,
    }),
  );

  const reading = $derived<CommitReading | null>(query.data ?? null);
  const files = $derived([...(earlier?.files ?? []), ...(reading?.files ?? [])]);
  const failed = $derived(query.error);
  const others = $derived(reading === null || thread === undefined ? 0 : Math.max(0, reading.changed - reading.total));

  function more(): void {
    const next = reading?.next;
    if (next === null || next === undefined) return;
    paged = { aim, files, cursor: next };
  }
</script>

{#snippet inGit(placed: string)}
  <a
    href={home === undefined ? undefined : addresses.commit(commit, home)}
    class={['flex shrink-0 items-center gap-0.5 text-muted-foreground/80 transition-colors hover:text-foreground', placed]}
    data-commit-in-git
    onclick={(event) => {
      if (home === undefined) return;
      event.preventDefault();
      void opening.open(commitLink({ sha: commit, project: home }), 'full', here);
    }}
    oncontextmenu={(event) => {
      if (home === undefined) return;
      event.preventDefault();
      opening.menu(commitLink({ sha: commit, project: home }), { x: event.clientX, y: event.clientY }, here);
    }}
  >
    Open in Git<ArrowUpRight class="size-3" />
  </a>
{/snippet}

<div class="grid min-w-0 gap-px pb-1" data-commit-files={commit}>
  {#if heading}
    <div class="flex h-5 min-w-0 items-center gap-2 pr-2 text-small text-muted-foreground/60" style:padding-left={inset}>
      <span class="shrink-0 font-mono text-meta text-muted-foreground/80">{commit.slice(0, SHORT_SHA)}</span>
      <FadeText class="min-w-0" text={author ?? reading?.author ?? ''} />
      {#if gitLink}{@render inGit('ml-auto')}{/if}
    </div>
  {/if}
  {#if failed !== undefined && failed !== null}
    <div class="py-1 pr-2" style:padding-left={inset}>
      <ReadingFailed
        failure={failed}
        title="This commit's files could not be read"
        onRetry={() => void query.refresh().catch(() => undefined)}
      />
    </div>
  {:else if reading === null && earlier === null}
    <div class="grid gap-2 py-1 pr-2" style:padding-left={inset} aria-busy="true">
      <span class="block h-2 w-3/5 animate-pulse rounded-sm bg-selected"></span>
      <span class="block h-2 w-2/5 animate-pulse rounded-sm bg-selected"></span>
    </div>
  {:else}
    <ChangeList items={files} {grouped} {selected} {depth} {onOpen} {onKeep} {link} {aside} />
    {#if reading?.next !== null && reading?.next !== undefined}
      <button
        type="button"
        class="flex h-6 items-center rounded-md text-left text-small text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground"
        style:padding-left={inset}
        onclick={more}
      >
        Show more
      </button>
    {/if}
    {#if others > 0}
      <p class="flex h-6 items-center text-small text-muted-foreground/55" style:padding-left={inset} data-commit-others={others}>
        +{others} more in this commit
      </p>
    {/if}
  {/if}
  {#if gitLink && !heading}
    <div class="flex h-6 items-center text-small" style:padding-left={inset}>{@render inGit('')}</div>
  {/if}
</div>
