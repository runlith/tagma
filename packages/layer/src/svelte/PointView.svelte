<script lang="ts" generics="Props extends Record<string, unknown>, Item extends Shown<Props, unknown>">
  import type { Snippet } from 'svelte';

  import type { Point } from '../Point.js';
  import type { Shown, ViewOf } from './payload.js';
  import ShownPayload from './ShownPayload.svelte';

  type Given = { props: Props; propsOf?: never } | { propsOf: (item: Item) => Props; props?: never };
  type Base = Given & {
    point: Point<Item>;
    only?: (item: Item) => boolean;
    gate?: (item: Item) => Item['payload'] | null;
    frame?: Snippet<[Snippet]>;
  };
  type Views = [ViewOf<Item>] extends [never] ? { view?: never } : { view: Snippet<[ViewOf<Item>, Props]> };

  let { point, props, propsOf, only, gate, frame, view }: Base & Views = $props();

  const shown = $derived(
    (only === undefined ? point.items : point.items.filter(only)).flatMap((item) => {
      const payload = gate === undefined ? item.payload : gate(item);
      return payload === null ? [] : [{ item, payload }];
    }),
  );
  const given = (item: Item): Props => (propsOf === undefined ? (props as Props) : propsOf(item));
</script>

{#snippet list()}
  {#each shown as { item, payload } (point.key(item))}
    <ShownPayload
      id={`${point.id}/${point.key(item)}`}
      payload={payload as Shown<Props, ViewOf<Item>>['payload']}
      props={given(item)}
      {view}
    />
  {/each}
{/snippet}

{#if shown.length > 0}
  {#if frame}
    {@render frame(list)}
  {:else}
    {@render list()}
  {/if}
{/if}
