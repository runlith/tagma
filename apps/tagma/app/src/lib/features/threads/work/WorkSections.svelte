<script lang="ts">
  import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import type { DidBlockRow, HeldWorkRow, ThreadWork as Work } from '@tagma/server/graph/contract/wire/threadWork';
  import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
  import { commitLink } from '$lib/features/checkout/links.js';
  import { SHORT_SHA } from '$lib/features/checkout/reading.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { blockLink } from '$lib/features/graph/links.js';
  import { statusLabel, statusText } from '$lib/features/graph/status.js';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import { aimOf, ThreadWork } from '$lib/features/graph/ThreadWork.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import ReadingFailed from '$lib/shared/ReadingFailed.svelte';
  import { timeAgo } from '$lib/shared/time.js';
  import { ThreadList } from '../List.svelte.js';

  let { projectId, threadId }: { projectId: number; threadId: string } = $props();

  const work = ThreadWork.use();
  const opening = Opening.use();
  const list = ThreadList.use();
  const commits = CommitLinks.use();
  const here = App.current();

  let cursors = $state<readonly (string | null)[]>([null]);
  const pages = $derived(cursors.map((cursor) => work.of(projectId, threadId, cursor)));
  const answer = $derived(pages[0]?.data);
  const tail = $derived(pages.at(-1)?.data);

  const did = $derived.by(() => {
    const seen = new Set<string>();
    return pages.flatMap((page) => {
      const shown = page.data;
      if (shown === undefined) return [];
      return shown.did.flatMap((row) => {
        const key = `${shown.copies[row.copy]?.projectId}:${shown.copies[row.copy]?.branch ?? ''}:${row.name}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ key, row, shown }];
      });
    });
  });

  work.keep(
    () => projectId,
    () => threadId,
    () => answer,
    () => list.row(threadId)?.activeRunId ?? null,
  );

  const from = $derived({ thread: threadId });

  const blockOf = (shown: Work, copy: number, name: string) => blockLink({ name, copy: aimOf(shown, copy) }, from);

  const subjectOf = (shown: Work, row: DidBlockRow, sha: string) => {
    const peer = commits.peer(sha);
    return peer == null || 'error' in peer || peer.project !== shown.copies[row.copy]?.project ? undefined : peer.subject;
  };

  const commitOf = (shown: Work, row: DidBlockRow, sha: string) => {
    const project = shown.copies[row.copy]?.project;
    return project === undefined ? null : commitLink({ sha, project, subject: subjectOf(shown, row, sha) }, from);
  };

  const tone = (row: HeldWorkRow | DidBlockRow) => (row.status === null ? 'text-muted-foreground' : statusText(row.status));

  const ROW = 'flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-ui transition-colors hover:bg-hover';
  const SUB =
    'flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1.5 pl-8 text-left text-small text-muted-foreground transition-colors hover:bg-hover';
  const HEAD = 'px-1.5 pb-1 text-small font-medium text-muted-foreground';
</script>

<div class="grid gap-5 p-3" data-thread-work={threadId}>
  {#if answer === undefined}
    {#if pages[0]?.error}
      <ReadingFailed
        failure={pages[0].error}
        title="The thread’s work could not be read"
        onRetry={() => void pages[0]?.refresh().catch(() => undefined)}
      />
    {:else}
      <div class="grid place-items-center py-8"><Waiting class="size-4 text-muted-foreground" label="Reading the thread’s work" /></div>
    {/if}
  {:else}
    {#if answer.works.length > 0}
      <section class="grid gap-0.5" data-works-on>
        <h3 class={HEAD}>Works on</h3>
        {#each answer.works as row (`${row.copy}:${row.name}`)}
          <button type="button" class={ROW} {@attach linkTarget(opening, () => blockOf(answer, row.copy, row.name), here)}>
            <TagIcon tag={row.tags[0] ?? null} class="size-3.5 shrink-0 {tone(row)}" />
            <FadeText class="flex-1" text={row.title} />
            {#if row.status !== null}<span class="shrink-0 text-small text-muted-foreground">{statusLabel(row.status)}</span>{/if}
          </button>
          {#if row.spec !== null}
            {@const spec = row.spec}
            <button type="button" class={SUB} {@attach linkTarget(opening, () => blockOf(answer, row.copy, spec.name), here)}>
              <span class="shrink-0">under</span>
              <TagIcon tag={spec.tags[0] ?? null} class="size-3 shrink-0" />
              <FadeText text={spec.title} />
            </button>
          {/if}
        {/each}
      </section>
    {/if}
    <section class="grid gap-0.5" data-did>
      <h3 class={HEAD}>Did</h3>
      {#each did as { key, row, shown } (key)}
        <button type="button" class={ROW} {@attach linkTarget(opening, () => blockOf(shown, row.copy, row.name), here)}>
          <span class="w-14 shrink-0 text-small text-muted-foreground">{row.last}</span>
          <TagIcon tag={row.tags[0] ?? null} class="size-3.5 shrink-0 {tone(row)}" />
          <FadeText class={['flex-1', row.trashed && 'text-muted-foreground line-through']} text={row.title} />
          <span class="shrink-0 text-small text-muted-foreground tabular-nums">{timeAgo(row.at)}</span>
        </button>
        {#if row.commit !== null}
          {@const sha = row.commit}
          {@const subject = subjectOf(shown, row, sha)}
          <button type="button" class={SUB} {@attach linkTarget(opening, () => commitOf(shown, row, sha), here)}>
            <GitCommitHorizontal class="size-3 shrink-0 text-mutation" />
            <span class="stamp shrink-0 text-mutation">{sha.slice(0, SHORT_SHA)}</span>
            {#if subject !== undefined}<FadeText class="flex-1" text={subject} />{/if}
          </button>
        {:else if row.commitUnread !== null}
          <p class={SUB} title={row.commitUnread}>
            <FadeText text="The commit of this ending could not be read" />
          </p>
        {/if}
      {:else}
        <p class="px-1.5 text-ui text-muted-foreground">This thread has not written to the graph yet.</p>
      {/each}
      {#if tail?.next}
        {@const next = tail.next}
        <button
          type="button"
          class="mt-1 h-7 rounded-md px-1.5 text-left text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          onclick={() => (cursors = [...cursors, next])}
        >
          Show more of {answer.total}
        </button>
      {/if}
    </section>
    {#each answer.unread as copy (`${copy.projectId}:${copy.checkout}`)}
      <p class="px-1.5 text-small text-muted-foreground" title={copy.reason}>
        <FadeText text={`A graph copy at ${copy.checkout} could not be read`} />
      </p>
    {/each}
  {/if}
</div>
