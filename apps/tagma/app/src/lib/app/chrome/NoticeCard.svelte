<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import X from '@lucide/svelte/icons/x';
  import Callout from '@runlith/chat-ui/Callout.svelte';
  import { fly, type FlyParams } from 'svelte/transition';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { cn } from '$lib/shared/utils.js';
  import { Notices, type Notice } from '$lib/features/notices/Service.svelte.js';
  import { actOf, SystemSettings } from '$lib/shared/SystemSettings.js';
  import { hasDetails } from '$lib/wire/told.js';
  import ToldDetails from '$lib/shared/ToldDetails.svelte';
  import { Addresses } from '$lib/features/workspace/Addresses.js';

  let { notice, thumb, enter }: { notice: Notice; thumb: boolean; enter: FlyParams } = $props();

  const notices = Notices.use();
  const addresses = Addresses.use();
  const systemSettings = SystemSettings.find();

  let open = $state(false);
  let clipped = $state(false);

  const told = $derived(notice.told);
  const act = $derived(told === undefined ? undefined : actOf(told, systemSettings));
  const detailed = $derived(open || clipped || (told !== undefined && hasDetails(told)));
  const title = $derived(told?.text ?? notice.title);
  const note = $derived(told === undefined ? (notice.kind === 'error' ? notice.body : undefined) : told.note);

  const dismiss = (): void => notices.dismiss(notice.id);
</script>

{#snippet actions()}
  {#if act !== undefined}
    <Button
      variant={notice.kind === 'offer' ? 'default' : 'outline'}
      size="xs"
      onclick={() => {
        act.run();
        if (notice.kind === 'offer') dismiss();
      }}
      data-told-act
    >
      {act.label}
    </Button>
  {/if}
  {#if detailed}
    <button
      type="button"
      class="inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-small text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      Details<ChevronRight class={cn('size-3 transition-transform', open && 'rotate-90')} />
    </button>
  {/if}
{/snippet}

<div class={cn('max-w-full', thumb ? 'w-full' : 'w-80')} data-notice={notice.kind} in:fly|global={enter}>
  {#if notice.kind === 'undo'}
    <div class="relative overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-float">
      <div class="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
        <p class="min-w-0 flex-1 text-ui break-words">{title}</p>
        <Button
          variant="outline"
          size="xs"
          onclick={() => {
            notice.undo?.();
            dismiss();
          }}
        >
          Undo
        </Button>
        <Button variant="ghost" size="icon-xs" class="text-muted-foreground" onclick={dismiss}>
          <X class="size-3.5" />
          <span class="sr-only">Dismiss</span>
        </Button>
      </div>
      {#if notice.lifeMs !== undefined}
        <span class="absolute inset-x-0 bottom-0 h-0.5 bg-vein">
          <span class="drain absolute inset-y-0 left-0 bg-muted-foreground" style:animation-duration="{notice.lifeMs}ms"></span>
        </span>
      {/if}
    </div>
  {:else}
    <Callout
      tone={notice.kind === 'offer' || notice.kind === 'said' ? 'plain' : 'error'}
      {title}
      {note}
      onDismiss={dismiss}
      clamp={!open}
      bind:clipped
      class="bg-popover text-popover-foreground shadow-float"
      actions={act !== undefined || detailed ? actions : undefined}
    >
      {#if open && told !== undefined}
        <ToldDetails {told} linked={told.code?.startsWith('stealth-') === true ? (name) => addresses.block(name) : undefined} />
      {/if}
    </Callout>
  {/if}
</div>

<style>
  .drain {
    animation-name: drain;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }

  @keyframes drain {
    from {
      width: 100%;
    }
    to {
      width: 0;
    }
  }
</style>
