<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import { Select, type SelectOption } from '@runlith/primitives/select.svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/shared/utils.js';

  let { value, label, disabled = false, class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> & SelectOption = $props();

  const select = Select.use();
  const option = (): SelectOption => ({ value, label, disabled });
  const listed = select.listed();
</script>

{#if listed}
  <div
    {...rest}
    role="option"
    data-slot="select-item"
    data-disabled={disabled ? '' : undefined}
    aria-disabled={disabled ? 'true' : undefined}
    class={cn(
      "relative flex min-h-7 w-full cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-2 text-ui outline-hidden select-none data-highlighted:bg-selected data-highlighted:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
      className,
    )}
    {@attach select.item(option)}
  >
    <span class="absolute end-2 flex size-3.5 items-center justify-center">
      {#if select.value === value}
        <CheckIcon class="size-3.5" />
      {/if}
    </span>
    {#if children}
      {@render children()}
    {:else}
      {label}
    {/if}
  </div>
{:else}
  <span {@attach select.label(option)}></span>
{/if}
