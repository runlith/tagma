<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { untrack } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import CodeXml from '@lucide/svelte/icons/code-xml';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import SquareDashedMousePointer from '@lucide/svelte/icons/square-dashed-mouse-pointer';
  import X from '@lucide/svelte/icons/x';
  import type { PageId, ProfileId } from '@tagma/server/browser/contract/wire/ids';
  import type { Page } from '@tagma/server/browser/contract/wire/page';
  import type { Profile } from '@tagma/server/browser/contract/wire/profile';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { ZOOM_KEYS, zoomStep } from './zoom.js';
  import ZoomLevel from './ZoomLevel.svelte';
  import { Door } from '$lib/wire/Door.js';
  import { Live } from '$lib/wire/Live.js';
  import { addressOf } from './address.js';
  import { ClosedPages } from './ClosedPages.svelte.js';
  import { DesktopPages } from './DesktopPages.svelte.js';
  import Downloads from './Downloads.svelte';
  import PageFind from './PageFind.svelte';
  import { OpenPages } from './OpenPages.svelte.js';
  import PageNotices from './PageNotices.svelte';
  import { Picks } from './pick/Picks.js';
  import { browserPane, shownId as paneId, shownOf } from './panes.js';
  import { adapterOf } from './view/adapter.js';
  import PageView from './view/PageView.svelte';

  let { pane, close, project }: { pane: SidePane; close: () => void; project: number } = $props();

  if (untrack(() => project) !== ProjectRung.Current.use().projectId) App.hold(ProjectRung, { projectId: untrack(() => project) });

  const open = OpenPages.use();
  const panes = SidePanes.use();
  const door = Door.use();
  const live = Live.use();
  const keymap = Keymap.use();
  const desktop = DesktopPages.use();
  const picks = Picks.use();
  const closedPages = ClosedPages.use();

  const listing = open.listing;
  const projectId = open.aim.projectId;
  const lens = { project: String(projectId) };

  const paneShows = $derived(shownOf(pane.id)?.page ?? null);
  const current = $derived<Page | null>(paneShows === null ? null : (listing.byId.get(paneShows) ?? null));
  const shownId = $derived(current?.id ?? null);
  const native = $derived(current !== null && desktop.bridge !== null && adapterOf(current, desktop.host) === 'native');

  let profiles = $state.raw<readonly Profile[]>([]);
  let profile = $state<ProfileId | null>(null);
  let typed = $state('');
  let editing = $state(false);
  let finding = $state(false);
  let picking = $state(false);
  let problem = $state<string | null>(null);
  const zooms = new Map<PageId, number>();
  let zoom = $state(1);
  let address = $state<HTMLInputElement>();
  let find = $state<{ focus(): void }>();

  const point = (page: PageId | null) => panes.point(pane.key, page === null ? null : paneId({ project: projectId, page }));

  async function act<T>(work: () => Promise<T>): Promise<T | null> {
    problem = null;
    try {
      return await work();
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  $effect(() => {
    void act(async () => {
      profiles = (await door.perform('list_profiles', {}, {})).profiles;
    });
  });

  $effect(() => {
    if (!editing) typed = current?.url === 'about:blank' ? '' : (current?.url ?? '');
  });

  $effect(() => {
    zoom = shownId === null ? 1 : (zooms.get(shownId) ?? 1);
    finding = false;
  });

  $effect(() => {
    const page = shownId;
    if (!picking || page === null) return;
    const held = live.hold(
      (client) => client['browser.pick']({ projectId, page }),
      async (picked) => {
        const notice = await picks.stage(picked);
        if (notice !== null) problem = notice;
      },
      (failure) => {
        problem = failure.message;
        picking = false;
      },
    );
    return () => held.unsubscribe();
  });

  $effect(() => {
    untrack(() => {
      if (pane.id === null && panes.focus === pane.key) address?.focus();
    });
  });

  async function openPage(url: string): Promise<void> {
    const opened = await act(() => door.perform('open_page', { url, profile: profile ?? undefined }, lens));
    if (opened !== null) point(opened.page.id);
  }

  async function closePage(page: PageId): Promise<void> {
    if ((await act(() => closedPages.close(page))) !== null) close();
  }

  function go(to: 'back' | 'forward' | 'reload' | 'stop'): void {
    const page = current?.id;
    if (page !== undefined) void act(() => door.perform('navigate_page', { page, go: to }, lens));
  }

  function submit(): void {
    const url = addressOf(typed);
    editing = false;
    address?.blur();
    if (url === null) return;
    const page = current?.id;
    if (page === undefined) void openPage(url);
    else void act(() => door.perform('navigate_page', { page, url }, lens));
  }

  function zoomTo(factor: number): void {
    const page = current?.id;
    if (page === undefined || desktop.bridge === null) return;
    zoom = factor;
    zooms.set(page, factor);
    desktop.bridge.zoom(page, factor);
  }

  function seek(): void {
    if (!native) return;
    finding = true;
    requestAnimationFrame(() => find?.focus());
  }

  const mine = (page: string | null): boolean => (page === null ? panes.focus === pane.key : page === current?.id);

  $effect(() => {
    const bound = (key: string, run: (page: string | null) => void, shift = false) => ({
      chord: keymap.mod(key, { shift }),
      run: (page: string | null) => {
        if (!mine(page)) return false;
        run(page);
        return true;
      },
    });
    return keymap.bind([
      bound('KeyT', () => panes.open(browserPane(null))),
      bound('KeyW', () => (current === null || pane.agent === true ? close() : void closePage(current.id))),
      bound('KeyT', () => void act(() => closedPages.reopen()), true),
      bound('KeyL', () => {
        address?.focus();
        address?.select();
      }),
      bound('BracketLeft', () => go('back')),
      bound('BracketRight', () => go('forward')),
      bound('KeyR', () => go('reload')),
      bound('KeyF', seek),
      ...(native
        ? [
            bound(ZOOM_KEYS.in, () => zoomTo(zoomStep(zoom, 1))),
            bound(ZOOM_KEYS.in, () => zoomTo(zoomStep(zoom, 1)), true),
            bound(ZOOM_KEYS.out, () => zoomTo(zoomStep(zoom, -1))),
            bound(ZOOM_KEYS.reset, () => zoomTo(1)),
          ]
        : []),
    ]);
  });

  $effect(() => {
    if (!picking) return;
    return keymap.bind([
      {
        chord: keymap.bare('Escape'),
        run: (page) => {
          if (page !== null && page !== current?.id) return false;
          picking = false;
          return true;
        },
      },
    ]);
  });

  const suggestions = $derived(
    [
      ...new Set(
        [...listing.byId.values(), ...closedPages.listed].map((page) => page.url).filter((url) => url !== '' && url !== 'about:blank'),
      ),
    ].slice(0, 50),
  );
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="Browser" data-browser-pane={pane.key}>
  <div class="flex h-10 min-w-0 shrink-0 items-center gap-0.5 border-b px-1">
    <Tooltip text="Back">
      <button type="button" class="tool" aria-label="Back" disabled={!current?.live.back} onclick={() => go('back')}>
        <ArrowLeft class="size-4" />
      </button>
    </Tooltip>
    <Tooltip text="Forward">
      <button type="button" class="tool" aria-label="Forward" disabled={!current?.live.forward} onclick={() => go('forward')}>
        <ArrowRight class="size-4" />
      </button>
    </Tooltip>
    {#if current?.live.loading}
      <Tooltip text="Stop">
        <button type="button" class="tool" aria-label="Stop" onclick={() => go('stop')}><X class="size-4" /></button>
      </Tooltip>
    {:else}
      <Tooltip text="Reload">
        <button type="button" class="tool" aria-label="Reload" disabled={current === null} onclick={() => go('reload')}>
          <RotateCw class="size-4" />
        </button>
      </Tooltip>
    {/if}
    {#if current === null && profiles.length > 1}
      <select
        class="h-7 max-w-28 shrink-0 rounded-md bg-background px-1 text-small text-muted-foreground hover:bg-hover"
        aria-label="Profile of the page"
        value={profile ?? ''}
        onchange={(event) => (profile = event.currentTarget.value === '' ? null : (event.currentTarget.value as ProfileId))}
      >
        <option value="">Default profile</option>
        {#each profiles as one (one.id)}
          <option value={one.id} disabled={!one.connected}>{one.name}</option>
        {/each}
      </select>
    {/if}
    <form
      class="min-w-0 flex-1"
      onsubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        bind:this={address}
        bind:value={typed}
        class="h-7 w-full min-w-0 rounded-md bg-field px-2 text-ui"
        list="browser-history-{pane.key}"
        placeholder="Search or type an address"
        aria-label="Address"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        onfocus={(event) => {
          editing = true;
          event.currentTarget.select();
        }}
        onblur={() => (editing = false)}
        onkeydown={(event) => {
          if (event.key !== 'Escape') return;
          editing = false;
          typed = current?.url ?? '';
          address?.blur();
        }}
      />
      <datalist id="browser-history-{pane.key}">
        {#each suggestions as url (url)}<option value={url}></option>{/each}
      </datalist>
    </form>
    {#if native}
      <ZoomLevel {zoom} {zoomTo} />
      <Tooltip text="Developer tools">
        <button
          type="button"
          class="tool"
          aria-label="Developer tools"
          onclick={() => current !== null && desktop.bridge?.devtools(current.id)}
        >
          <CodeXml class="size-4" />
        </button>
      </Tooltip>
    {/if}
    {#if current !== null}<Downloads page={current} />{/if}
    <Tooltip text={picking ? 'Stop picking' : 'Pick elements into the chat'} keys={picking ? keymap.spell(keymap.bare('Escape')) : null}>
      <button
        type="button"
        class="tool"
        aria-label="Pick elements into the chat"
        aria-pressed={picking}
        disabled={current === null}
        onclick={() => (picking = !picking)}
      >
        <SquareDashedMousePointer class="size-4" />
      </button>
    </Tooltip>
  </div>

  {#if finding && native && current !== null && desktop.bridge !== null}
    <PageFind bind:this={find} page={current.id} bridge={desktop.bridge} done={() => (finding = false)} />
  {/if}

  {#if picking}
    <p class="shrink-0 border-b bg-raised px-3 py-1.5 text-small text-muted-foreground">
      Click elements on the page to put them into the field of the thread you worked in last.
      <Kbd chord={keymap.spell(keymap.bare('Escape'))} size="sm" /> stops.
    </p>
  {/if}

  {#if problem !== null}
    <p class="shrink-0 border-b bg-sunken px-3 py-1.5 text-small text-destructive">{problem}</p>
  {/if}

  {#if current !== null}
    <PageNotices page={current} {lens} close={() => void closePage(current.id)} />
  {/if}

  <div class="relative min-h-0 flex-1">
    {#if current !== null}
      <PageView page={current} panel={pane.key} />
    {:else}
      <div class="grid size-full place-items-center px-8 text-center text-small text-muted-foreground">
        {pane.id !== null && listing.listed
          ? 'This page is closed. Type an address to open another.'
          : (listing.failure ?? 'Type an address or a search above.')}
      </div>
    {/if}
  </div>
</section>

<style>
  .tool {
    display: grid;
    width: calc(var(--spacing) * 7);
    height: calc(var(--spacing) * 7);
    flex-shrink: 0;
    place-items: center;
    border-radius: var(--radius-md);
    color: var(--color-muted-foreground);
  }

  .tool:hover:not(:disabled) {
    background: var(--color-hover);
    color: var(--color-foreground);
  }

  .tool[aria-pressed='true'] {
    background: var(--color-selected);
    color: var(--color-foreground);
  }

  .tool:disabled {
    opacity: 0.4;
  }
</style>
