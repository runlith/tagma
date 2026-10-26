<script lang="ts" module>
  import { cn, type WithElementRef } from '$lib/shared/utils.js';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

  const BASE =
    "data-[dialog-autofocus]:border-ring aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border border-transparent bg-clip-padding text-ui font-medium active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*='size-'])]:size-3.5 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0";

  const VARIANTS = {
    default: 'bg-primary text-primary-foreground hover:opacity-90',
    outline: 'border-border bg-transparent hover:bg-hover hover:text-foreground aria-expanded:bg-selected aria-expanded:text-foreground',
    secondary: 'bg-hover text-foreground hover:bg-selected aria-expanded:bg-selected',
    ghost: 'hover:bg-hover hover:text-foreground aria-expanded:bg-selected aria-expanded:text-foreground',
    quiet:
      'text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-selected aria-expanded:text-foreground aria-pressed:bg-selected aria-pressed:text-foreground',
    destructive: 'border-destructive/40 text-destructive hover:bg-hover-danger',
    confirm: 'bg-destructive text-primary-foreground hover:opacity-90',
    link: 'text-primary underline-offset-4 hover:underline',
  } as const;

  const SIZES = {
    default: 'h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
    xs: "h-6 gap-1 px-2 text-small has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
    sm: 'h-7 gap-1 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5',
    icon: 'size-8',
    'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3",
    'icon-sm': 'size-7',
  } as const;

  export type ButtonVariant = keyof typeof VARIANTS;
  export type ButtonSize = keyof typeof SIZES;
  export type ButtonLook = { variant?: ButtonVariant; size?: ButtonSize };

  export function buttonVariants({ variant = 'default', size = 'default' }: ButtonLook = {}): string {
    return cn(BASE, VARIANTS[variant], SIZES[size]);
  }

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
      size?: ButtonSize;
    };
</script>

<script lang="ts">
  let {
    class: className,
    variant = 'default',
    size = 'default',
    ref = $bindable(null),
    href = undefined,
    type = 'button',
    disabled,
    children,
    ...restProps
  }: ButtonProps = $props();
</script>

{#if href}
  <a
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    href={disabled ? undefined : href}
    aria-disabled={disabled}
    role={disabled ? 'link' : undefined}
    tabindex={disabled ? -1 : undefined}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else}
  <button bind:this={ref} data-slot="button" class={cn(buttonVariants({ variant, size }), className)} {type} {disabled} {...restProps}>
    {@render children?.()}
  </button>
{/if}
