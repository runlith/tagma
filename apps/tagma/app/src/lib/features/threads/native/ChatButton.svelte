<script lang="ts" module>
  import type { ChatControl } from '@runlith/chat-ui/renderers';
  import type { ButtonSize, ButtonVariant } from '$lib/shared/ui/button/index.js';

  type ControlLook = { variant: ButtonVariant; size: ButtonSize; class: string; label?: string; destructiveClass?: string };

  const QUIET: ControlLook = {
    variant: 'ghost',
    size: 'icon-sm',
    class: 'rounded-md text-muted-foreground hover:bg-hover pointer-coarse:size-11',
  };

  const CONTROL_LOOKS: Record<ChatControl, ControlLook> = {
    attach: QUIET,
    submit: {
      variant: 'default',
      size: 'icon-sm',
      class: 'rounded-md disabled:bg-hover disabled:text-muted-foreground disabled:opacity-100 pointer-coarse:size-11',
    },
    stop: { variant: 'default', size: 'icon-sm', class: 'rounded-md transition-none pointer-coarse:size-11' },
    confirm: { variant: 'default', size: 'sm', class: 'rounded-md pointer-coarse:h-11 pointer-coarse:px-4' },
    cancel: { variant: 'outline', size: 'sm', class: 'rounded-md pointer-coarse:h-11 pointer-coarse:px-4' },
    mode: {
      variant: 'ghost',
      size: 'sm',
      class:
        'h-6 gap-1 rounded-md px-1.5 text-meta font-medium text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-100 [&_svg]:size-3 @min-[30rem]:h-7 @min-[30rem]:gap-1.5 @min-[30rem]:px-2 @min-[30rem]:text-small @min-[30rem]:[&_svg]:size-3.5',
      label: 'hidden @min-[22rem]:inline',
      destructiveClass:
        'h-6 gap-1 rounded-md px-1.5 text-meta font-medium text-destructive hover:bg-hover-danger hover:text-destructive disabled:opacity-100 [&_svg]:size-3 @min-[30rem]:h-7 @min-[30rem]:gap-1.5 @min-[30rem]:px-2 @min-[30rem]:text-small @min-[30rem]:[&_svg]:size-3.5',
    },
  };
</script>

<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import type { ChatButton } from '@runlith/chat-ui/renderers';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { spellKey } from '$lib/shared/chordSpelling.js';
  import { Button, buttonVariants } from '$lib/shared/ui/button/index.js';
  import { cn } from '$lib/shared/utils.js';

  let { control }: { control: ChatButton } = $props();

  const keymap = Keymap.use();

  const base = $derived(CONTROL_LOOKS[control.control]);
  const dress = $derived<ControlLook>(
    control.destructive
      ? { ...base, variant: 'destructive', class: base.destructiveClass ?? base.class }
      : control.quiet
        ? { ...QUIET, class: cn(QUIET.class, 'transition-none') }
        : base,
  );
  const choices = $derived(control.choices ?? []);
</script>

{#snippet main(className: string)}
  <Tooltip text={control.title ?? (control.icon ? control.label : undefined)} hints={control.hints}>
    <Button
      type={control.type}
      variant={dress.variant}
      size={dress.size}
      class={className}
      disabled={control.disabled}
      aria-label={control.icon ? control.label : undefined}
      onclick={control.onclick}
    >
      {#if control.icon}
        {@render control.icon()}
      {:else if control.leading}
        {@render control.leading()}
        <span class={dress.label}>{control.label}</span>
      {:else}
        {control.label}
      {/if}
    </Button>
  </Tooltip>
{/snippet}

{#if choices.length === 0}
  {@render main(dress.class)}
{:else}
  <DropdownMenu.Root>
    <span class="inline-flex shrink-0 items-center">
      {@render main(`${dress.class} rounded-r-none`)}
      <DropdownMenu.Trigger
        class={cn(
          buttonVariants({ variant: dress.variant, size: dress.size }),
          dress.class,
          'w-5 rounded-l-none border-l-primary-foreground/25 pr-0.5 disabled:border-l-transparent pointer-coarse:w-8',
        )}
        aria-label={control.choicesLabel}
        disabled={control.disabled}
      >
        <ChevronDown class="size-3" />
      </DropdownMenu.Trigger>
    </span>
    <DropdownMenu.Content align="end" class="min-w-56" returnFocus={control.choiceFocus}>
      {#each choices as choice (choice.label)}
        <DropdownMenu.Item icon={choice.icon} keys={choice.key ? spellKey(choice.key, keymap.mac) : null} onSelect={choice.onSelect}>
          {choice.label}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
