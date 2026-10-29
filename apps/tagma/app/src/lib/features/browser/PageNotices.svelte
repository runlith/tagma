<script lang="ts">
  import Gauge from '@lucide/svelte/icons/gauge';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { conditionsOf } from '@tagma/server/browser/contract/wire/emulation';
  import type { Page } from '@tagma/server/browser/contract/wire/page';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { Door, type Lens } from '$lib/wire/Door.js';

  let { page, lens, close }: { page: Page; lens: Lens; close: () => void } = $props();

  const door = Door.use();

  let answer = $state('');
  let problem = $state<string | null>(null);
  let askedBy: string | null = null;

  $effect.pre(() => {
    const dialog = page.live.dialog;
    const asking = dialog === null ? null : [page.id, dialog.kind, dialog.url, dialog.message, dialog.prompt ?? ''].join('\n');
    if (asking === askedBy) return;
    askedBy = asking;
    answer = dialog?.prompt ?? '';
  });

  async function act(work: () => Promise<unknown>): Promise<void> {
    problem = null;
    await work().catch((error: unknown) => {
      problem = error instanceof Error ? error.message : String(error);
    });
  }

  const reply = (accept: boolean) =>
    act(() => door.perform('answer_page_dialog', { page: page.id, accept, text: accept ? answer : undefined }, lens));

  const reload = () => act(() => door.perform('navigate_page', { page: page.id, go: 'reload' }, lens));

  const conditions = $derived(conditionsOf(page.live.conditions));

  const resetConditions = () => act(() => door.perform('emulate_page', { page: page.id, conditions: false }, lens));
</script>

{#if page.live.dialog !== null}
  {@const dialog = page.live.dialog}
  <div class="flex shrink-0 flex-col gap-2 border-b bg-raised px-3 py-2 shadow-raised" role="alertdialog" aria-label="The page asks">
    <p class="text-ui whitespace-pre-wrap">
      {dialog.message || (dialog.kind === 'beforeunload' ? 'Leave this page? Changes you made may not be saved.' : 'The page asks you.')}
    </p>
    {#if dialog.kind === 'prompt'}
      <input class="h-7 rounded-md bg-field px-2 text-ui" bind:value={answer} aria-label="Answer" />
    {/if}
    <div class="flex justify-end gap-2">
      {#if dialog.kind !== 'alert'}
        <Button size="sm" variant="ghost" onclick={() => void reply(false)}>{dialog.kind === 'beforeunload' ? 'Stay' : 'Cancel'}</Button>
      {/if}
      <Button size="sm" onclick={() => void reply(true)}>{dialog.kind === 'beforeunload' ? 'Leave' : 'OK'}</Button>
    </div>
  </div>
{:else if page.live.crashed}
  <div class="flex shrink-0 items-center gap-2 border-b bg-raised px-3 py-1.5 text-small">
    <TriangleAlert class="size-3.5 shrink-0 text-destructive" />
    <span class="min-w-0 flex-1">The page crashed.</span>
    <Button size="sm" variant="ghost" onclick={() => void reload()}>Reload</Button>
  </div>
{:else if !page.live.responsive}
  <div class="flex shrink-0 items-center gap-2 border-b bg-raised px-3 py-1.5 text-small">
    <TriangleAlert class="size-3.5 shrink-0 text-destructive" />
    <span class="min-w-0 flex-1">The page is not responding.</span>
    <Button size="sm" variant="ghost" onclick={() => void reload()}>Reload</Button>
    <Button size="sm" variant="ghost" onclick={close}>Close</Button>
  </div>
{:else if page.state === 'away'}
  <p class="shrink-0 border-b bg-raised px-3 py-1.5 text-small text-muted-foreground">
    The host of this page is not connected; it comes back when its host does.
  </p>
{/if}
{#if conditions !== null}
  <div class="flex shrink-0 items-center gap-2 border-b bg-raised px-3 py-1.5 text-small">
    <Gauge class="size-3.5 shrink-0 text-muted-foreground" />
    <FadeText class="min-w-0 flex-1" text={`Under test conditions: ${conditions}`} />
    <Button size="sm" variant="ghost" onclick={() => void resetConditions()}>Reset</Button>
  </div>
{/if}
{#if problem !== null}
  <p class="shrink-0 border-b bg-sunken px-3 py-1.5 text-small text-destructive">{problem}</p>
{/if}
