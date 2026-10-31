<script lang="ts" generics="Props extends Record<string, unknown>, View, Item extends Shown<Props, View>">
  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';
  import type { Snippet } from 'svelte';

  import type { Point } from '../Point.js';
  import type { Shown } from './payload.js';

  type Base = { point: Point<Item>; props: Props; frame?: Snippet<[Snippet]> };
  type Views = [View] extends [never] ? { view?: never } : { view: Snippet<[View, Props]> };

  let { point, props, frame, view }: Base & Views = $props();
</script>

{#snippet list()}
  {#each point.items as item (point.key(item))}
    <ErrorBoundary id={`${point.id}/${point.key(item)}`}>
      {#if 'component' in item.payload}
        {@const Contributed = item.payload.component}
        <Contributed {...props} />
      {:else}
        {@render view?.(item.payload.view, props)}
      {/if}
    </ErrorBoundary>
  {/each}
{/snippet}

{#if point.items.length > 0}
  {#if frame}
    {@render frame(list)}
  {:else}
    {@render list()}
  {/if}
{/if}
