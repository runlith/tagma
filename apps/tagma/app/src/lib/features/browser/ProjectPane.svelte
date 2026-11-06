<script lang="ts">
  import { untrack } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import CodeXml from '@lucide/svelte/icons/code-xml';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import SquareDashedMousePointer from '@lucide/svelte/icons/square-dashed-mouse-pointer';
  import X from '@lucide/svelte/icons/x';
  import type { PageId, ProfileId } from '@tagma/server/browser/contract/wire/ids';
  import type { Page } from '@tagma/server/browser/contract/wire/page';
  import type { Profile } from '@tagma/server/browser/contract/wire/profile';
  import { userProfile } from '@tagma/server/browser/contract/wire/settings';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
  import { SettingsRepo, writtenCatalog } from '$lib/features/settings/SettingsRepo.js';
  import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
  import { holdProject } from '$lib/features/workspace/holds.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import type { SidePane } from '$lib/shared/panes/pane.js';
  import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import Working from '$lib/shared/ui/Working.svelte';
  import { zoomStep } from './zoom.js';
  import ZoomLevel from './ZoomLevel.svelte';
  import { Door } from '$lib/wire/Door.js';
  import { Live } from '$lib/wire/Live.js';
  import { editable } from './address.js';
  import AddressBar from './AddressBar.svelte';
  import { ClosedPages } from './ClosedPages.svelte.js';
  import { DesktopPages } from './DesktopPages.svelte.js';
  import Downloads from './Downloads.svelte';
  import { Omnibox } from './Omnibox.svelte.js';
  import PageFind from './PageFind.svelte';
  import { OpenPages } from './OpenPages.svelte.js';
  import PageNotices from './PageNotices.svelte';
  import { Picks } from './pick/Picks.js';
  import { browserPane, shownId as paneId, shownOf, showPage } from './panes.js';
  import { ServedAddresses } from './served.js';
  import { adapterOf } from './view/adapter.js';
  import PageView from './view/PageView.svelte';

  let { pane, close, project }: { pane: SidePane; close: () => void; project: number } = $props();

  if (untrack(() => project) !== ProjectRung.Current.use().projectId) holdProject(untrack(() => project));

  const open = OpenPages.use();
  const panes = SidePanes.use();
  const door = Door.use();
  const live = Live.use();
  const keymap = Keymap.use();
  const desktop = DesktopPages.use();
  const picks = Picks.use();
  const closedPages = ClosedPages.use();
  const served = ServedAddresses.use();
  const settings = SettingsRepo.use();
  const names = ThreadNames.use();

  const listing = open.listing;
  const projectId = open.aim.projectId;
  const lens = { project: String(projectId) };
  const uid = $props.id();
  const list = `${uid}-suggestions`;

  const paneShows = $derived(shownOf(pane.id)?.page ?? null);
  const current = $derived<Page | null>(paneShows === null ? null : (listing.byId.get(paneShows) ?? null));
  const shownId = $derived(current?.id ?? null);
  const native = $derived(current !== null && desktop.bridge !== null && adapterOf(current, desktop.host) === 'native');

  let profiles = $state.raw<readonly Profile[]>([]);
  let profile = $state<ProfileId | null>(null);
  let finding = $state(false);
  let picking = $state(false);
  let problem = $state<string | null>(null);
  const zooms = new Map<PageId, number>();
  let zoom = $state(1);
  let find = $state<{ focus(): void }>();

  const usual = $derived.by((): ProfileId | null => {
    const catalog = writtenCatalog(settings, projectId) ?? settings.catalog.key(projectId).data;
    if (catalog === undefined) return null;
    const value = catalog.entries.find((entry) => entry.id === userProfile.id)?.value;
    return typeof value === 'string' ? (value as ProfileId) : userProfile.fallback;
  });
  const nameOf = (id: ProfileId | null): string | null => (id === null ? null : (profiles.find((one) => one.id === id)?.name ?? null));
  const differing = $derived(current === null || usual === null || current.profile === usual ? null : nameOf(current.profile));
  const opening = $derived(profile ?? usual);
  const driver = $derived.by((): string | null => {
    const thread = current?.live.driven ?? null;
    return thread === null ? null : (names.of(thread)?.label ?? 'An agent');
  });

  const omnibox = new Omnibox(
    () => ({ served: served.addresses, open: listing.pages, closed: closedPages.listed, current: current?.id ?? null }),
    () => (current === null ? '' : editable(current.url)),
    { go: (url) => go(url), visit: (page) => showPage(panes, { project: projectId, page }) },
  );

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
    if (current !== null && !omnibox.open) return;
    untrack(() => {
      closedPages.read().catch((error: unknown) => {
        problem = error instanceof Error ? error.message : String(error);
      });
    });
  });

  $effect(() => {
    zoom = shownId === null ? 1 : (zooms.get(shownId) ?? 1);
    finding = false;
    untrack(() => omnibox.close());
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
      if (pane.id === null && panes.focus === pane.key) omnibox.focus();
    });
  });

  async function openPage(url: string): Promise<void> {
    const opened = await act(() => door.perform('open_page', { url, profile: profile ?? undefined }, lens));
    if (opened !== null) point(opened.page.id);
  }

  async function closePage(page: PageId): Promise<void> {
    if ((await act(() => closedPages.close(page))) !== null) close();
  }

  function navigate(to: 'back' | 'forward' | 'reload' | 'stop'): void {
    const page = current?.id;
    if (page !== undefined) void act(() => door.perform('navigate_page', { page, go: to }, lens));
  }

  function go(url: string): void {
    const page = current?.id;
    if (page === undefined) void openPage(url);
    else void act(() => door.perform('navigate_page', { page, url }, lens));
  }

  function edit(): void {
    if (current === null) omnibox.focus();
    else omnibox.edit();
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
    const bound = (action: string, run: () => void) =>
      keymap.handle(action, ({ page }) => {
        if (!mine(page)) return false;
        run();
        return true;
      });
    const releases = [
      bound('tab.close', () => (current === null || pane.agent === true ? close() : void closePage(current.id))),
      bound('tab.reopen', () => void act(() => closedPages.reopen())),
      bound('browser.address', edit),
      bound('history.back', () => navigate('back')),
      bound('history.forward', () => navigate('forward')),
      bound('browser.reload', () => navigate('reload')),
      bound('browser.find', seek),
      ...(native
        ? [
            bound('page.zoom-in', () => zoomTo(zoomStep(zoom, 1))),
            bound('page.zoom-out', () => zoomTo(zoomStep(zoom, -1))),
            bound('page.zoom-reset', () => zoomTo(1)),
          ]
        : []),
    ];
    return () => {
      for (const release of releases) release();
    };
  });

  $effect(() => {
    if (!picking) return;
    return keymap.handle('browser.stop-picking', ({ page }) => {
      if (page !== null && page !== current?.id) return false;
      picking = false;
      return true;
    });
  });
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="Browser" data-browser-pane={pane.key}>
  <div class="flex h-10 min-w-0 shrink-0 items-center gap-0.5 border-b px-1">
    <Tooltip text="Back">
      <button type="button" class="tool" aria-label="Back" disabled={!current?.live.back} onclick={() => navigate('back')}>
        <ArrowLeft class="size-4" />
      </button>
    </Tooltip>
    <Tooltip text="Forward">
      <button type="button" class="tool" aria-label="Forward" disabled={!current?.live.forward} onclick={() => navigate('forward')}>
        <ArrowRight class="size-4" />
      </button>
    </Tooltip>
    {#if current?.live.loading}
      <Tooltip text="Stop">
        <button type="button" class="tool" aria-label="Stop" onclick={() => navigate('stop')}><X class="size-4" /></button>
      </Tooltip>
    {:else}
      <Tooltip text="Reload">
        <button type="button" class="tool" aria-label="Reload" disabled={current === null} onclick={() => navigate('reload')}>
          <RotateCw class="size-4" />
        </button>
      </Tooltip>
    {/if}
    <AddressBar {omnibox} page={current} {list} profile={differing}>
      {#snippet end()}
        {#if native}<ZoomLevel {zoom} {zoomTo} />{/if}
        {#if driver !== null}
          <span class="flex max-w-32 shrink-0 items-center gap-1.5 pl-1 text-small text-muted-foreground">
            <Working /><FadeText text={driver} />
          </span>
        {/if}
      {/snippet}
    </AddressBar>
    {#if native}
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
    <Tooltip text={picking ? 'Stop picking' : 'Pick elements into the chat'} keys={picking ? keymap.spell('browser.stop-picking') : null}>
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
    {@const stop = keymap.spell('browser.stop-picking')}
    <p class="shrink-0 border-b bg-raised px-3 py-1.5 text-small text-muted-foreground">
      Click elements on the page to put them into the field of the thread you worked in last.
      {#if stop !== null}<Kbd chord={stop} size="sm" /> stops.{/if}
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
      <div class="size-full overflow-y-auto">
        <div class="flex flex-col gap-2 px-4 py-3">
          {#if pane.id !== null && listing.listed}
            <p class="text-small text-muted-foreground">This page is closed.</p>
          {:else if listing.failure !== null}
            <p class="text-small text-muted-foreground">{listing.failure}</p>
          {/if}
          {#if profiles.length > 1}
            <div class="flex items-center gap-1 text-small text-muted-foreground">
              Opens in
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  class="flex h-6 items-center gap-1 rounded-md px-1.5 text-small text-foreground hover:bg-hover data-[state=open]:bg-selected"
                >
                  <FadeText class="max-w-48" text={nameOf(opening) ?? 'Default'} /><ChevronDown
                    class="size-3 shrink-0 text-muted-foreground"
                  />
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="start" class="min-w-44">
                  <DropdownMenu.RadioGroup
                    value={opening ?? undefined}
                    onValueChange={(chosen) => (profile = chosen === usual ? null : (chosen as ProfileId))}
                  >
                    {#each profiles as one (one.id)}
                      <DropdownMenu.RadioItem value={one.id} disabled={!one.connected}>{one.name}</DropdownMenu.RadioItem>
                    {/each}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>
          {/if}
        </div>
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
