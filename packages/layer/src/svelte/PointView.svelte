<script lang="ts" generics="Props extends Record<string, unknown>, Item extends Shown<Props, unknown>">
  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';
  import type { Snippet } from 'svelte';

  import type { Point } from '../Point.js';
  import type { Shown, ViewOf } from './payload.js';

  type Given = { props: Props; propsOf?: never } | { propsOf: (item: Item) => Props; props?: never };
  type Base = Given & { point: Point<Item>; only?: (item: Item) => boolean; frame?: Snippet<[Snippet]> };
  type Views = [ViewOf<Item>] extends [never] ? { view?: never } : { view: Snippet<[ViewOf<Item>, Props]> };

  let { point, props, propsOf, only, frame, view }: Base & Views = $props();

  const items = $derived(only === undefined ? point.items : point.items.filter(only));
  const given = (item: Item): Props => (propsOf === undefined ? (props as Props) : propsOf(item));
</script>

{#snippet list()}
  {#each items as item (point.key(item))}
    <ErrorBoundary id={`${point.id}/${point.key(item)}`}>
      {#if 'component' in item.payload}
        {@const Contributed = item.payload.component}
        <Contributed {...given(item)} />
      {:else}
        {@render view?.(item.payload.view as ViewOf<Item>, given(item))}
      {/if}
    </ErrorBoundary>
  {/each}
{/snippet}

{#if items.length > 0}
  {#if frame}
    {@render frame(list)}
  {:else}
    {@render list()}
  {/if}
{/if}
