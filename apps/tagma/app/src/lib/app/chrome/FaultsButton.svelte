<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Copy from '@lucide/svelte/icons/copy';
  import * as Popover from '$lib/shared/ui/popover/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { linkTarget, onLinkOpened } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import { threadLink } from '$lib/features/presence/link.js';
  import type { ThreadAddress } from '$lib/features/workspace/ShellOps.js';
  import { formatSpan } from '$lib/shared/figures.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { ServerFaults } from './ServerFaults.svelte.js';

  type Row = {
    readonly key: string;
    readonly title: string;
    readonly message: string;
    readonly count: number;
    readonly lastAt: number;
    readonly thread: ThreadAddress | null;
    readonly report: string;
  };

  const notices = Notices.use();
  const server = ServerFaults.use();
  const opening = Opening.use();
  const surface = App.current();
  const clock = WallClock.use();

  let open = $state(false);
  $effect(() => {
    if (open) return clock.watch();
  });

  const rows = $derived.by((): Row[] => {
    const served = (server.page?.faults ?? []).map((fault): Row => ({
      key: `server:${fault.fingerprint}`,
      title: fault.place,
      message: fault.message,
      count: fault.count,
      lastAt: fault.lastAt,
      thread: fault.thread !== null && fault.project !== null ? { projectId: fault.project, threadId: fault.thread } : null,
      report: [
        `${fault.place}: ${fault.message}`,
        ...(fault.stack === null ? [] : ['', fault.stack]),
        '',
        ...(fault.thread === null ? [] : [`thread ${fault.thread}`]),
        ...(fault.run === null ? [] : [`run ${fault.run}`]),
        `activity ${fault.activity}`,
      ].join('\n'),
    }));
    const own = notices.faults.map((fault): Row => ({
      key: `window:${fault.key}`,
      title: fault.title,
      message: fault.body,
      count: fault.count,
      lastAt: fault.lastAt,
      thread: null,
      report: [`${fault.title}: ${fault.body}`, ...(fault.stack === null ? [] : ['', fault.stack])].join('\n'),
    }));
    return [...served, ...own].sort((left, right) => right.lastAt - left.lastAt);
  });
  const total = $derived(rows.reduce((sum, row) => sum + row.count, 0));
  const unshown = $derived(Math.max(0, (server.page?.total ?? 0) - (server.page?.faults.length ?? 0)));

  $effect(() => {
    if (rows.length === 0) open = false;
  });
</script>

{#if rows.length > 0}
  <Popover.Root bind:open>
    <Popover.Trigger
      class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-destructive tabular-nums transition-colors hover:bg-hover data-[state=open]:bg-selected"
      aria-label="Errors"
      data-faults
    >
      <CircleAlert class="size-3.5" />
      <span>{total} {total === 1 ? 'error' : 'errors'}</span>
    </Popover.Trigger>
    <Popover.Content
      side="top"
      align="end"
      sideOffset={6}
      collisionPadding={12}
      class="w-[32rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0 text-small"
    >
      <header class="flex items-center gap-2 px-3 pt-3 pb-2">
        <b class="text-ui font-semibold">Errors</b>
        <FadeText
          class="min-w-0 flex-1 text-small text-muted-foreground"
          text="Defects of the server and this window, not refusals · Copy takes the stack"
        />
        <button
          type="button"
          class="shrink-0 rounded-md border border-border px-2 py-0.5 text-small hover:bg-hover"
          disabled={server.clearing}
          onclick={() => void server.clear()}>Clear</button
        >
      </header>
      <ul class="max-h-[min(28rem,calc(100dvh-8rem))] overflow-y-auto border-t border-border" {@attach onLinkOpened(() => (open = false))}>
        {#each rows as row (row.key)}
          <li class="group/fault grid gap-1 border-t border-vein/70 px-3 py-2 first:border-t-0">
            <div class="flex min-w-0 items-center gap-2 text-small text-muted-foreground">
              <FadeText class="min-w-0 font-medium text-destructive" text={row.title} />
              {#if row.count > 1}<span class="stamp shrink-0 tabular-nums">×{row.count}</span>{/if}
              <span class="stamp shrink-0 tabular-nums">{formatSpan(Math.max(0, clock.now - row.lastAt))} ago</span>
              <span class="flex-1"></span>
              {#if row.thread !== null}
                {@const thread = row.thread}
                <button
                  type="button"
                  class="shrink-0 rounded-sm px-1 hover:bg-hover hover:text-foreground"
                  {@attach linkTarget(opening, () => threadLink(thread), surface)}>Thread</button
                >
              {/if}
              <button
                type="button"
                class="grid size-5 shrink-0 place-items-center rounded-sm opacity-0 transition-opacity group-hover/fault:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100"
                aria-label="Copy"
                onclick={() => void navigator.clipboard?.writeText(row.report)}
              >
                <Copy class="size-3" />
              </button>
            </div>
            <p class="stamp text-meta leading-snug break-words whitespace-pre-wrap select-text [overflow-wrap:anywhere]">{row.message}</p>
          </li>
        {/each}
        {#if unshown > 0}
          <li class="border-t border-vein/70 px-3 py-2 text-meta text-muted-foreground">{unshown} older not shown</li>
        {/if}
      </ul>
    </Popover.Content>
  </Popover.Root>
{/if}
