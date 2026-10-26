<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ComposerDropState } from './composer';
  import {
    COMPOSER_ACTION_LEFT_CLASS,
    COMPOSER_ACTION_RIGHT_CLASS,
    COMPOSER_ACTION_ROW_CLASS,
    COMPOSER_FRAME_CLASS,
  } from './composerFrame';

  type Props = {
    media?: Snippet;
    edge?: Snippet;
    input: Snippet;
    leftActions?: Snippet;
    rightActions: Snippet;
    alert?: boolean;
    drop?: ComposerDropState | null;
  };

  let { media, edge, input, leftActions, rightActions, alert = false, drop = null }: Props = $props();
</script>

<div
  class={COMPOSER_FRAME_CLASS}
  data-composer-frame
  data-alert={alert ? '' : undefined}
  data-dropping={drop === 'ready' ? '' : undefined}
  data-aimed={drop === 'aimed' ? '' : undefined}
>
  {#if edge}
    <div class="absolute -top-2 right-6 z-10 flex gap-1">
      {@render edge()}
    </div>
  {/if}

  {#if media}
    {@render media()}
  {/if}

  {@render input()}

  <div class={COMPOSER_ACTION_ROW_CLASS}>
    <div class={COMPOSER_ACTION_LEFT_CLASS}>
      {#if leftActions}
        {@render leftActions()}
      {/if}
    </div>
    <div class={COMPOSER_ACTION_RIGHT_CLASS}>
      {@render rightActions()}
    </div>
  </div>
</div>
