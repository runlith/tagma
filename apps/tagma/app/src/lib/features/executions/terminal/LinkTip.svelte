<script lang="ts">
  import FadeText from '$lib/shared/FadeText.svelte';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';
  import { LINK_TIP_EVENT, type LinkTip } from './links.js';

  let tip = $state.raw<LinkTip>({ text: '', hints: [] });
</script>

<div
  class="pane-link-tip xterm-hover"
  data-link-tip
  style="display: none; position: absolute; bottom: 0; left: 0;"
  {@attach (element) => {
    const told = (event: Event): void => {
      tip = (event as CustomEvent<LinkTip>).detail;
    };
    element.addEventListener(LINK_TIP_EVENT, told);
    return () => element.removeEventListener(LINK_TIP_EVENT, told);
  }}
>
  <FadeText class="min-w-0" text={tip.text} />
  {#each tip.hints as hint (hint.keys)}
    <span class="flex shrink-0 items-center gap-1.5"><Kbd chord={hint.keys} size="sm" />{hint.words}</span>
  {/each}
</div>

<style>
  .pane-link-tip {
    box-sizing: border-box;
    z-index: 40;
    margin: 0;
    border-radius: 0 var(--radius-sm) 0 0;
    border: 1px solid var(--border);
    border-bottom: none;
    border-left: none;
    padding: var(--spacing) calc(var(--spacing) * 2);
    line-height: 15px;
    max-width: 80%;
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 2);
    white-space: nowrap;
    pointer-events: none;
    font-size: var(--text-meta);
    font-family: inherit;
    color: var(--muted-foreground);
    background: var(--popover);
  }
</style>
