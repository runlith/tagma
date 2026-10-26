<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import FadeText from '$lib/shared/FadeText.svelte';
  import { cn } from '$lib/shared/utils.js';
  import { GroupHeading } from './heading.svelte.js';

  let {
    id: given,
    class: className,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & { children?: Snippet } = $props();

  const generated = $props.id();
  const id = $derived(given ?? generated);
  GroupHeading.label(() => id);
</script>

<div
  {...rest}
  {id}
  data-slot="dropdown-menu-group-heading"
  class={cn('flex items-center gap-2 px-2 pt-1.5 pb-1 text-meta font-medium text-muted-foreground', className)}
>
  <span class="size-3.5 shrink-0" aria-hidden="true"></span>
  <FadeText class="flex-1">{@render children?.()}</FadeText>
</div>
