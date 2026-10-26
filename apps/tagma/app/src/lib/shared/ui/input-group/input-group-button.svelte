<script lang="ts" module>
  const SIZES = {
    xs: "h-6 gap-1 rounded-sm px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
    sm: '',
    'icon-xs': 'size-6 rounded-sm p-0 has-[>svg]:p-0',
    'icon-sm': 'size-6 p-0 has-[>svg]:p-0',
  } as const;

  export type InputGroupButtonSize = keyof typeof SIZES;
</script>

<script lang="ts">
  import { cn } from '$lib/shared/utils.js';
  import type { ComponentProps } from 'svelte';
  import { Button } from '$lib/shared/ui/button/index.js';

  let {
    ref = $bindable(null),
    class: className,
    children,
    type = 'button',
    variant = 'ghost',
    size = 'xs',
    ...restProps
  }: Omit<ComponentProps<typeof Button>, 'href' | 'size'> & {
    size?: InputGroupButtonSize;
  } = $props();
</script>

<Button
  bind:ref
  {type}
  data-size={size}
  {variant}
  class={cn('flex items-center gap-2 text-ui shadow-none', SIZES[size], className)}
  {...restProps}
>
  {@render children?.()}
</Button>
