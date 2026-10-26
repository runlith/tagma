<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import Globe from '@lucide/svelte/icons/globe';
  import Keyboard from '@lucide/svelte/icons/keyboard';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import type { PageId } from '@tagma/server/browser/contract/wire/ids';
  import { Router } from '@runlith/layer/Router';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { Door } from '$lib/wire/Door.js';
  import { Live } from '$lib/wire/Live.js';
  import { ProjectPages } from './ProjectPages.svelte.js';
  import CastView from './screencast/CastView.svelte';
  import Downloads from './Downloads.svelte';

  let { project, pageId }: { project: string; pageId: PageId | null } = $props();

  const workspace = Workspace.use();
  const live = Live.use();
  const door = Door.use();
  const router = Router.use();

  const projectId = $derived(workspace.active?.name === project ? workspace.activeId : null);
  let listing = $state.raw<ProjectPages | null>(null);
  $effect(() => {
    if (projectId === null) return;
    const held = new ProjectPages(live, projectId);
    listing = held;
    return () => {
      held.close();
      listing = null;
    };
  });

  const current = $derived(pageId === null ? undefined : listing?.byId.get(pageId));
  const home = $derived(`/${encodeURIComponent(project)}/w`);

  let view = $state<{ type(): void }>();
  let answer = $state('');
  let problem = $state<string | null>(null);

  async function act(work: () => Promise<unknown>): Promise<void> {
    problem = null;
    await work().catch((error: unknown) => {
      problem = error instanceof Error ? error.message : String(error);
    });
  }

  const go = (page: PageId, to: 'back' | 'reload') => act(() => door.perform('navigate_page', { page, go: to }, { project }));

  const reply = (page: PageId, accept: boolean) =>
    act(() => door.perform('answer_page_dialog', { page, accept, text: accept ? answer : undefined }, { project }));
</script>

<div class="flex h-full min-h-0 flex-1 flex-col bg-background">
  <header class="flex h-12 shrink-0 items-center gap-1 border-b bg-chrome px-1">
    {#if pageId !== null}
      <button
        type="button"
        class="grid size-11 shrink-0 place-items-center rounded-full active:bg-hover"
        aria-label="Pages"
        onclick={() => void router.goto(home)}
      >
        <ChevronLeft class="size-4" />
      </button>
    {:else}
      <span class="w-3 shrink-0"></span>
    {/if}
    <div class="flex min-w-0 flex-1 flex-col justify-center">
      <h1 class="min-w-0 truncate text-body font-semibold">{pageId === null ? 'Pages' : current?.title || current?.url || 'Page'}</h1>
      {#if current !== undefined}<p class="min-w-0 truncate text-small text-muted-foreground">{current.url}</p>{/if}
    </div>
    {#if current !== undefined}
      <button
        type="button"
        class="grid size-11 place-items-center rounded-full active:bg-hover disabled:text-muted-foreground"
        aria-label="Back"
        disabled={!current.live.back}
        onclick={() => void go(current.id, 'back')}
      >
        <ArrowLeft class="size-4" />
      </button>
      <button
        type="button"
        class="grid size-11 place-items-center rounded-full active:bg-hover"
        aria-label="Reload"
        onclick={() => void go(current.id, 'reload')}
      >
        <RotateCw class="size-4" />
      </button>
      <Downloads page={current} touch />
      <button
        type="button"
        class="grid size-11 place-items-center rounded-full active:bg-hover"
        aria-label="Keyboard"
        onclick={() => view?.type()}
      >
        <Keyboard class="size-4" />
      </button>
    {/if}
  </header>

  {#if problem !== null}
    <p class="shrink-0 border-b bg-sunken px-4 py-2 text-small text-destructive">{problem}</p>
  {/if}

  {#if listing === null}
    <p class="grid flex-1 place-items-center px-8 text-center text-body text-muted-foreground">No project named “{project}”.</p>
  {:else if pageId === null}
    <ul class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {#each listing.pages as page (page.id)}
        <li>
          <a class="flex min-h-12 items-center gap-3 border-b px-4 py-2 active:bg-hover" href={`${home}/${encodeURIComponent(page.id)}`}>
            {#if page.favicon !== null}
              <img
                src={page.favicon}
                alt=""
                class="size-4 shrink-0"
                onerror={(event) => (event.currentTarget as HTMLImageElement).classList.add('invisible')}
              />
            {:else}
              <Globe class="size-4 shrink-0 text-muted-foreground" />
            {/if}
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-body">{page.title || page.url}</span>
              <span class="truncate text-small text-muted-foreground">
                {page.live.driven !== null ? 'An agent drives it · ' : ''}{page.state === 'live' ? page.url : `${page.state} · ${page.url}`}
              </span>
            </span>
          </a>
        </li>
      {:else}
        <li class="px-8 py-12 text-center text-body text-muted-foreground">
          {listing.listed ? 'No pages are open in this project.' : (listing.failure ?? 'Reading the pages…')}
        </li>
      {/each}
    </ul>
  {:else if projectId !== null}
    {#if current?.live.dialog}
      {@const dialog = current.live.dialog}
      <div class="flex shrink-0 flex-col gap-2 border-b bg-raised px-4 py-3 shadow-raised">
        <p class="text-body">{dialog.message || (dialog.kind === 'beforeunload' ? 'Leave this page?' : 'The page asks you.')}</p>
        {#if dialog.kind === 'prompt'}
          <input class="min-h-11 rounded-md bg-field px-3 text-body" bind:value={answer} placeholder={dialog.prompt ?? ''} />
        {/if}
        <div class="flex justify-end gap-2">
          {#if dialog.kind !== 'alert'}
            <button
              type="button"
              class="min-h-11 rounded-md px-4 text-body text-muted-foreground active:bg-hover"
              onclick={() => void reply(current.id, false)}>Cancel</button
            >
          {/if}
          <button
            type="button"
            class="min-h-11 rounded-md bg-primary px-4 text-body font-medium text-primary-foreground"
            onclick={() => void reply(current.id, true)}>OK</button
          >
        </div>
      </div>
    {/if}
    <div class="relative min-h-0 flex-1">
      {#key pageId}
        <CastView bind:this={view} {projectId} page={pageId} />
      {/key}
    </div>
  {/if}
</div>
