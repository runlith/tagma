<script lang="ts">
  import type { Timeline } from '@tagma/server/artifacts/contract/wire/timeline';
  import type { Snippet } from 'svelte';
  import Frame from '$lib/shared/frame/Frame.svelte';
  import { PAGE_SANDBOX_FLAGS } from '@tagma/server/artifacts/contract/wire/policy';
  import { previewHeight } from './sizing.js';
  import type { MotionPlayer } from './MotionPlayer.svelte.js';
  import MotionView from './MotionView.svelte';

  type Props = {
    src: string;
    title: string;
    timeline: Timeline | null;
    fill?: boolean;
    zoom?: number;
    open?: () => void;
    actions?: Snippet<[MotionPlayer]>;
  };

  let { src, title, timeline, fill = false, zoom = 1, open, actions }: Props = $props();
</script>

{#if timeline !== null}
  {#key src}
    <MotionView {src} {title} {timeline} {fill} {actions} />
  {/key}
{:else if fill}
  <Frame {src} {title} sandbox={PAGE_SANDBOX_FLAGS} fill {zoom} class="border-0 bg-background" />
{:else}
  <div class="relative">
    <Frame {src} {title} sandbox={PAGE_SANDBOX_FLAGS} height={previewHeight()} inert class="border-0 bg-background" />
    {#if open !== undefined}
      <button type="button" class="absolute inset-0 cursor-pointer" aria-label={`Open ${title} in the panel`} onclick={open}></button>
    {/if}
  </div>
{/if}
