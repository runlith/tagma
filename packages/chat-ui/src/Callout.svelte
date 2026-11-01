<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { clampFade } from './clipFade';
  import Waiting from './Waiting.svelte';

  type Props = {
    tone: 'error' | 'plain' | 'pending';
    title: string;
    note?: string | undefined;
    onDismiss?: (() => void) | undefined;
    dismissLabel?: string;
    clamp?: boolean;
    clipped?: boolean;
    class?: ClassValue;
    children?: Snippet;
    actions?: Snippet;
  };

  let {
    tone,
    title,
    note,
    onDismiss,
    dismissLabel = 'Dismiss',
    clamp = false,
    clipped = $bindable(false),
    class: className,
    children,
    actions,
  }: Props = $props();

  $effect(() => {
    if (!clamp) clipped = false;
  });
</script>

<div class={['relative grid min-w-0 gap-1.5 rounded-lg border px-3 py-2 text-ui', className]} role={tone === 'error' ? 'alert' : 'status'}>
  {#if onDismiss}
    <button
      type="button"
      class="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      aria-label={dismissLabel}
      onclick={onDismiss}
    >
      <X class="size-3.5" />
    </button>
  {/if}
  <div
    class={['grid gap-0.5', onDismiss && 'pr-6', clamp && 'clamp']}
    data-clamp={clamp ? '' : undefined}
    {@attach clamp ? clampFade((value) => (clipped = value)) : undefined}
  >
    <p class="font-medium break-words text-foreground">
      {#if tone === 'pending'}
        <Waiting class="mr-2 inline-block size-3 align-middle text-muted-foreground" />
      {:else}
        <span
          class={['mr-2 inline-block size-1.5 align-middle', tone === 'error' ? 'bg-chat-failure' : 'bg-muted-foreground']}
          aria-hidden="true"
        ></span>
      {/if}{title}
    </p>
    {#if note !== undefined && note !== ''}
      <p class="text-small wrap-anywhere text-muted-foreground">{note}</p>
    {/if}
  </div>
  {@render children?.()}
  {#if actions}
    <div class="-ml-1 flex flex-wrap items-center gap-1">{@render actions()}</div>
  {/if}
</div>

<style>
  .clamp {
    max-height: calc(4lh + var(--spacing) * 5);
  }
</style>
