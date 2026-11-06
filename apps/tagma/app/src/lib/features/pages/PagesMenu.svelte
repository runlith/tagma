<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import FileText from '@lucide/svelte/icons/file-text';
  import type { ThreadPage } from '@tagma/server/artifacts/contract/wire/artifacts';
  import { Host } from '@runlith/layer/Host';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { ThreadPlaces } from '$lib/app/panes/ThreadPlaces.js';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { timeCompact } from '$lib/shared/time.js';
  import { showArtifact } from './panes.js';
  import { ThreadPages } from './ThreadPages.svelte.js';

  let { thread, onOpened }: { thread: string; onOpened: () => void } = $props();

  const COPIED_MS = 1_500;

  const pages = ThreadPages.use();
  const sides = SidePanes.use();
  const seats = ThreadPlaces.use();
  const outside = ExternalLinks.use();
  const host = Host.use();
  const keymap = Keymap.use();
  const panel = host.kind !== 'mobile';
  const copyChord = 'Mod+C';
  const copyKeys = keymap.spellText(copyChord);

  const team = $derived(pages.members);

  let copied = $state<string | null>(null);

  async function copy(page: ThreadPage): Promise<void> {
    await navigator.clipboard.writeText(page.artifact.url);
    copied = page.artifact.id;
    setTimeout(() => {
      if (copied === page.artifact.id) copied = null;
    }, COPIED_MS);
  }

  function chosen(event: Event, page: ThreadPage): void {
    if (event.target instanceof Element && event.target.closest('[data-page-copy]') !== null) {
      void copy(page);
      return;
    }
    const keys = event instanceof MouseEvent || event instanceof KeyboardEvent ? event : null;
    const away = keys !== null && ((host.apple ? keys.metaKey : keys.ctrlKey) || keys.shiftKey || keys.altKey);
    if (panel && !away) showArtifact(sides, seats, thread, page.artifact.id);
    else outside.open(page.artifact.url);
    onOpened();
  }

  function pressed(event: KeyboardEvent, page: ThreadPage): void {
    if (!keymap.matches(event, copyChord)) return;
    event.preventDefault();
    void copy(page);
  }

  function byline(page: ThreadPage): string | null {
    return page.thread === thread ? null : (team.names.get(page.thread) ?? null);
  }

  function opened(open: boolean): void {
    if (!open) pages.seen();
  }
</script>

{#if pages.total > 0}
  <DropdownMenu.Sub onOpenChange={opened}>
    <DropdownMenu.SubTrigger icon={FileText} current={String(pages.total)} data-thread-pages={pages.total}>Pages</DropdownMenu.SubTrigger>
    <DropdownMenu.SubContent class="w-88">
      {#each pages.pages as page (page.artifact.id)}
        {@const by = byline(page)}
        <DropdownMenu.Item
          closeOnSelect={false}
          onSelect={(event) => chosen(event, page)}
          onkeydown={(event: KeyboardEvent) => pressed(event, page)}
          title={page.artifact.description ?? undefined}
          textValue={page.artifact.title}
          data-thread-page={page.artifact.id}
        >
          {#snippet lead()}
            {#if pages.fresh.has(page.artifact.id)}<span class="size-1.5 bg-status-open" data-page-fresh></span>{/if}
          {/snippet}
          {#snippet tail()}
            <span class="relative flex h-5 min-w-5 items-center justify-end">
              <span
                class="text-meta tabular-nums text-muted-foreground group-hover/menu-row:invisible group-data-highlighted/menu-row:invisible"
                >{timeCompact(page.artifact.publishedAt)}</span
              >
              <Tooltip text="Copy link" keys={copyKeys}>
                <button
                  type="button"
                  tabindex="-1"
                  data-page-copy
                  aria-label={`Copy the link to ${page.artifact.title}`}
                  class="invisible absolute inset-y-0 right-0 grid w-5 place-items-center rounded-sm text-muted-foreground group-hover/menu-row:visible group-data-highlighted/menu-row:visible hover:text-foreground"
                >
                  {#if copied === page.artifact.id}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
                </button>
              </Tooltip>
            </span>
          {/snippet}
          {page.artifact.title}{#if by !== null}<span class="ml-1.5 text-muted-foreground">{by}</span>{/if}
        </DropdownMenu.Item>
      {/each}
      {#if pages.total > pages.pages.length}
        <DropdownMenu.Note text={`${pages.total - pages.pages.length} older not shown`} />
      {/if}
    </DropdownMenu.SubContent>
  </DropdownMenu.Sub>
{/if}
