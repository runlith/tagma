<script lang="ts">
  import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import { Door } from '$lib/wire/Door.js';
  import { refusalOf } from '$lib/wire/refusal.js';
  import { pictureAddress } from './Repo.js';
  import type { DiffEnd } from './diffEnds.js';
  import PathText from '$lib/shared/PathText.svelte';
  import ReadingFailed from '$lib/shared/ReadingFailed.svelte';

  type Placed = DiffEnd & { readonly path: string };

  let {
    projectId,
    rootId,
    path,
    before,
    after,
  }: {
    projectId: number;
    rootId: RootId;
    path: string;
    before: Placed | null;
    after: Placed | null;
  } = $props();

  type Shown =
    | { readonly kind: 'loading' }
    | { readonly kind: 'shown'; readonly url: string; readonly bytes: number }
    | { readonly kind: 'failed'; readonly failure: unknown };

  let retried = $state<Record<'before' | 'after', number>>({ before: 0, after: 0 });
  let shownBefore = $state<Shown>({ kind: 'loading' });
  let shownAfter = $state<Shown>({ kind: 'loading' });
  let sizes = $state<Record<'before' | 'after', string | null>>({ before: null, after: null });

  const door = Door.use();

  const addressOf = (end: Placed | null): string | null =>
    end === null ? null : pictureAddress(door, projectId, rootId, end.path, end.at);

  const beforeAddress = $derived(addressOf(before));
  const afterAddress = $derived(addressOf(after));

  function load(address: string | null, show: (shown: Shown) => void): () => void {
    if (address === null) return () => {};
    const controller = new AbortController();
    let url: string | null = null;
    show({ kind: 'loading' });
    void (async () => {
      try {
        const blob = await door.bytes(address, { signal: controller.signal });
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        show({ kind: 'shown', url, bytes: blob.size });
      } catch (error) {
        if (!controller.signal.aborted) show({ kind: 'failed', failure: refusalOf(error) });
      }
    })();
    return () => {
      controller.abort();
      if (url !== null) URL.revokeObjectURL(url);
    };
  }

  $effect(() => {
    retried.before;
    sizes.before = null;
    return load(beforeAddress, (shown) => (shownBefore = shown));
  });

  $effect(() => {
    retried.after;
    sizes.after = null;
    return load(afterAddress, (shown) => (shownAfter = shown));
  });

  const weight = (bytes: number): string =>
    bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  const CHECKER =
    'background-color:var(--color-muted);background-image:linear-gradient(45deg,var(--color-background) 25%,transparent 25%,transparent 75%,var(--color-background) 75%),linear-gradient(45deg,var(--color-background) 25%,transparent 25%,transparent 75%,var(--color-background) 75%);background-size:16px 16px;background-position:0 0,8px 8px';
</script>

{#snippet side(label: string, end: Placed, shown: Shown, key: 'before' | 'after')}
  <figure class="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5" data-picture-side={key}>
    <figcaption class="flex min-w-0 items-baseline gap-2 text-small">
      <span class={key === 'before' ? 'font-medium text-chat-diff-removed' : 'font-medium text-chat-diff-added'}>{label}</span>
      <span class="shrink-0 text-muted-foreground">{end.name}</span>
      {#if end.path !== path}<PathText class="text-muted-foreground" path={end.path} />{/if}
      {#if shown.kind === 'shown'}
        <span class="ml-auto shrink-0 font-mono text-meta tabular-nums text-muted-foreground">
          {sizes[key] === null ? '' : `${sizes[key]} · `}{weight(shown.bytes)}
        </span>
      {/if}
    </figcaption>
    {#if shown.kind === 'failed'}
      <ReadingFailed failure={shown.failure} title="The picture could not be read" onRetry={() => (retried[key] += 1)} />
    {:else}
      <div class="grid min-h-40 flex-1 place-items-center overflow-auto rounded-md border p-2" style={CHECKER}>
        {#if shown.kind === 'shown'}
          <img
            src={shown.url}
            alt="{path} at {end.name}"
            class="max-h-[70vh] max-w-full object-contain"
            onload={(event) => {
              const image = event.currentTarget as HTMLImageElement;
              sizes[key] = `${image.naturalWidth}×${image.naturalHeight}`;
            }}
          />
        {:else}
          <span class="block size-24 animate-pulse rounded-sm bg-selected" aria-busy="true"></span>
        {/if}
      </div>
    {/if}
  </figure>
{/snippet}

<div class="@container h-full min-h-0 overflow-auto" data-picture-diff={path}>
  <div class="flex min-h-full flex-col gap-3 p-3 @3xl:flex-row">
    {#if before !== null}
      {@render side(after === null ? 'Deleted' : 'Before', before, shownBefore, 'before')}
    {/if}
    {#if after !== null}
      {@render side(before === null ? 'Added' : 'After', after, shownAfter, 'after')}
    {/if}
  </div>
</div>
