<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { Seam } from '@runlith/seam/Seam.svelte';
  import SeamHandle from '@runlith/seam/SeamHandle.svelte';
  import { untrack } from 'svelte';
  import { Column } from '$lib/features/checkout/files/Column.svelte.js';
  import ColumnTabs from '$lib/features/checkout/files/ColumnTabs.svelte';
  import { Documents } from '$lib/features/checkout/files/Documents.svelte.js';
  import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
  import EditorArea from '$lib/features/checkout/files/EditorArea.svelte';
  import ExplorerView from '$lib/features/checkout/files/ExplorerView.svelte';
  import { commandOf, typingIn, underOverlay } from '$lib/features/checkout/files/keys.js';
  import SearchView from '$lib/features/checkout/files/SearchView.svelte';
  import { isPreviewable } from '$lib/features/checkout/files/tab.js';
  import { Tabs } from '$lib/features/checkout/files/Tabs.svelte.js';
  import { CheckoutScreen } from './CheckoutScreen.js';
  import { Seams } from '$lib/shared/seams/Seams.svelte.js';
  import { currentCommit } from '$lib/features/workspace/address.js';
  import { Checkout } from './Selection.svelte.js';
  import GitView from './GitView.svelte';
  import { CHECKOUT_SEAM } from './seams.js';

  let { onBoard }: { onBoard?: (() => void) | undefined } = $props();

  const checkout = Checkout.use();
  const seams = Seams.use();
  const column = Column.use();
  const onScreen = CheckoutScreen.use();
  const tabs = Tabs.use();
  const documents = Documents.use();
  const door = GraphDoor.use();
  const router = Router.use();

  const linked = $derived(currentCommit(router));
  $effect(() => {
    if (linked !== null) untrack(() => column.show('git'));
  });

  const row = $derived(checkout.row);

  const seam = new Seam(seams.seam(CHECKOUT_SEAM), { onCommit: (size) => seams.set(CHECKOUT_SEAM, size) });

  function keys(event: KeyboardEvent): void {
    if (event.defaultPrevented || underOverlay(event.target)) return;
    const active = tabs.active;
    if (event.key === 'Escape') {
      if (active === null || active.kind === 'diff' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!onScreen.mainFocused || typingIn(event.target)) return;
      event.preventDefault();
      tabs.close(active.id);
      return;
    }
    const command = commandOf(event);
    if (command === null) return;
    if (command.kind === 'column') column.show(command.view);
    else if (command.kind === 'close') {
      if (active === null) return;
      tabs.close(active.id);
    } else if (command.kind === 'reopen') tabs.reopen();
    else if (command.kind === 'step') tabs.step(command.direction);
    else if (command.kind === 'nth') tabs.nth(command.place);
    else if (command.kind === 'keep') {
      if (active !== null) {
        tabs.keep(active.id);
        void documents.flush({ projectId: door.aim.projectId, rootId: active.rootId }, active.path);
      }
    } else if (active !== null && isPreviewable(active.path) && (active.kind === 'file' || active.kind === 'preview')) {
      tabs.open(
        { rootId: active.rootId, branch: active.branch, path: active.path, kind: active.kind === 'file' ? 'preview' : 'file' },
        'open',
      );
    } else return;
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={keys} />

<div class="flex h-full min-h-0">
  <aside class="flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-chrome" style:width="{seam.size}px" data-checkout-list>
    {#if checkout.absent !== null}
      <p class="p-3 text-ui text-muted-foreground" data-checkout-absent={checkout.absent}>
        {checkout.absent === 'no-working-copy'
          ? 'No working copy for this branch'
          : (checkout.unreadReason ?? 'This checkout could not be read')}
      </p>
    {:else if row === null}
      <div class="grid gap-2 p-3" aria-busy="true">
        {#each [48, 76, 62, 70] as width, index (index)}
          <span class="block h-2 animate-pulse rounded-sm bg-selected" style:width="{width}%"></span>
        {/each}
      </div>
    {:else}
      <ColumnTabs changes={checkout.paths} />
      {#if column.view === 'files'}
        <ExplorerView />
      {:else if column.view === 'search'}
        <SearchView />
      {:else}
        <GitView {onBoard} />
      {/if}
    {/if}
  </aside>
  <SeamHandle {seam} label="Resize the files column" contained />

  <main class="flex min-h-0 min-w-0 flex-1 flex-col">
    {#if checkout.absent !== null}
      <p class="grid flex-1 place-items-center px-6 text-center text-ui text-muted-foreground" data-checkout-pick>
        Open tabs come back when this branch has a working copy again
      </p>
    {:else}
      <EditorArea />
    {/if}
  </main>
</div>
