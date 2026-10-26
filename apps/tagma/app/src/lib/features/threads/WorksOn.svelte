<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import type { HeldWorkRow, ThreadWork as Work } from '@tagma/server/graph/contract/wire/threadWork';
  import TagIcon from '$lib/features/graph/TagIcon.svelte';
  import { blockLink } from '$lib/features/graph/links.js';
  import { statusText } from '$lib/features/graph/status.js';
  import { aimOf, ThreadWork } from '$lib/features/graph/ThreadWork.svelte.js';
  import { linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import { toldOf } from '$lib/wire/refusal.js';
  import { ThreadList } from './List.svelte.js';

  let { projectId, threadId }: { projectId: number; threadId: string } = $props();

  const work = ThreadWork.use();
  const opening = Opening.use();
  const list = ThreadList.use();
  const here = App.current();

  const query = $derived(work.of(projectId, threadId));
  const answer = $derived(query.data);
  const works = $derived(answer?.works ?? []);
  const first = $derived(works[0]);

  work.keep(
    () => projectId,
    () => threadId,
    () => answer,
    () => list.row(threadId)?.activeRunId ?? null,
  );

  const linkOf = (shown: Work, row: HeldWorkRow, name = row.name) =>
    blockLink({ name, copy: aimOf(shown, row.copy) }, { thread: threadId });

  const tone = (row: HeldWorkRow) => (row.status === null ? 'text-muted-foreground' : statusText(row.status));

  const PIECE = 'flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 transition-colors hover:bg-hover hover:text-foreground';
</script>

{#if answer !== undefined && first !== undefined}
  <span class="no-drag-region flex min-w-0 max-w-96 shrink items-center text-small text-muted-foreground" data-thread-works>
    <button type="button" class={['max-w-56', PIECE]} {@attach linkTarget(opening, () => linkOf(answer, first), here)}>
      <TagIcon tag={first.tags[0] ?? null} class="size-3.5 shrink-0 {tone(first)}" />
      <FadeText text={first.title} />
    </button>
    {#if first.spec !== null}
      {@const spec = first.spec}
      <button
        type="button"
        class={['max-w-40 text-muted-foreground/70', PIECE]}
        {@attach linkTarget(opening, () => linkOf(answer, first, spec.name), here)}
      >
        <TagIcon tag={spec.tags[0] ?? null} class="size-3 shrink-0" />
        <FadeText text={spec.title} />
      </button>
    {/if}
    {#if works.length > 1}
      <Popover.Root>
        <Popover.Trigger
          class="h-6 shrink-0 rounded-md px-1.5 transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-selected"
          aria-label={`${works.length} works held`}
        >
          +{works.length - 1}
        </Popover.Trigger>
        <Popover.Content align="start" class="w-80 gap-0 p-1">
          {#each works as row (`${row.copy}:${row.name}`)}
            <button
              type="button"
              class="flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-ui transition-colors hover:bg-hover"
              {@attach linkTarget(opening, () => linkOf(answer, row), here)}
            >
              <TagIcon tag={row.tags[0] ?? null} class="size-3.5 shrink-0 {tone(row)}" />
              <FadeText text={row.title} />
            </button>
            {#if row.spec !== null}
              {@const spec = row.spec}
              <button
                type="button"
                class="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 pl-6 text-left text-small text-muted-foreground transition-colors hover:bg-hover"
                {@attach linkTarget(opening, () => linkOf(answer, row, spec.name), here)}
              >
                <span class="shrink-0">under</span>
                <TagIcon tag={spec.tags[0] ?? null} class="size-3 shrink-0" />
                <FadeText text={spec.title} />
              </button>
            {/if}
          {/each}
        </Popover.Content>
      </Popover.Root>
    {/if}
  </span>
{:else if answer === undefined && query.error}
  <button
    type="button"
    class={['no-drag-region max-w-56 text-small text-destructive', PIECE]}
    title={toldOf(query.error).text}
    data-thread-works-unread
    onclick={() => void query.refresh().catch(() => undefined)}
  >
    <FadeText text="Work unread" />
  </button>
{/if}
