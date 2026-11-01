<script lang="ts" generics="Props extends Record<string, unknown>, View">
  import ErrorBoundary from '@runlith/error-boundary/ErrorBoundary.svelte';
  import type { Snippet } from 'svelte';

  import type { Shown } from './payload.js';

  let {
    id,
    payload,
    props,
    view,
  }: { id: string; payload: Shown<Props, View>['payload']; props: Props; view?: Snippet<[View, Props]> | undefined } = $props();
</script>

<ErrorBoundary {id}>
  {#if 'component' in payload}
    {@const Contributed = payload.component}
    <Contributed {...props} />
  {:else}
    {@render view?.(payload.view, props)}
  {/if}
</ErrorBoundary>
