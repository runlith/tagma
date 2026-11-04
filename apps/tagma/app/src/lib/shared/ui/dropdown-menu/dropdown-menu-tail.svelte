<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import type { Snippet } from 'svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Kbd from '$lib/shared/ui/kbd/Kbd.svelte';

  let {
    keys,
    current,
    hint,
    here,
    tail,
  }: {
    keys?: string | null | undefined;
    current?: string | null | undefined;
    hint?: string | undefined;
    here?: boolean | undefined;
    tail?: Snippet | undefined;
  } = $props();
</script>

{#if keys}
  <span data-slot="dropdown-menu-shortcut" class="flex shrink-0 pl-3"><Kbd chord={keys} /></span>
{:else if current}
  <FadeText data-slot="dropdown-menu-current" data-yield class="ml-auto pl-2 text-muted-foreground" text={current} />
{:else if hint}
  <FadeText data-slot="dropdown-menu-hint" data-yield class="ml-auto pl-2 stamp text-muted-foreground" text={hint} />
{:else if here}
  <Check class="size-3.5 shrink-0 text-brand" />
{:else if tail}
  <span data-slot="dropdown-menu-tail" class="flex shrink-0 items-center">{@render tail()}</span>
{/if}
