<script lang="ts">
  import Camera from '@lucide/svelte/icons/camera';
  import FileText from '@lucide/svelte/icons/file-text';
  import Images from '@lucide/svelte/icons/images';
  import Users from '@lucide/svelte/icons/users';
  import { CHAT_DRAFT_PDF_ACCEPT } from '@runlith/chat-ui/draftFiles';
  import { CHAT_DRAFT_IMAGE_ACCEPT } from '@runlith/chat-ui/draftImages';
  import SwitchControl from '$lib/features/settings/controls/SwitchControl.svelte';
  import type { ThreadSlot } from '$lib/features/threads/ThreadSlot.svelte.js';
  import { modeIcon } from '$lib/features/threads/modeWords.js';
  import { cn } from '$lib/shared/utils.js';
  import Sheet from './Sheet.svelte';

  let { host, onClose }: { host: ThreadSlot; onClose: () => void } = $props();

  const modes = $derived(host.writes.modes);
  const active = $derived(modes?.declared.find((mode) => mode.id === modes.active) ?? null);
  const delegation = $derived(host.views.authority.delegation);

  function attach(event: Event): void {
    const picker = event.currentTarget as HTMLInputElement;
    const files = picker.files === null ? [] : Array.from(picker.files);
    picker.value = '';
    if (files.length === 0) return;
    void host.writes.perform(host.feeds.attach(files));
    onClose();
  }
</script>

<Sheet label="Message options" {onClose}>
  <div class="grid grid-cols-3 gap-2 px-5 pt-1 pb-3">
    <label class="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg bg-hover text-ui active:bg-selected">
      <Images class="size-4 text-muted-foreground" />
      Photos
      <input type="file" accept={CHAT_DRAFT_IMAGE_ACCEPT} multiple class="hidden" onchange={attach} />
    </label>
    <label class="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg bg-hover text-ui active:bg-selected">
      <Camera class="size-4 text-muted-foreground" />
      Camera
      <input type="file" accept={CHAT_DRAFT_IMAGE_ACCEPT} capture="environment" class="hidden" onchange={attach} />
    </label>
    <label class="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg bg-hover text-ui active:bg-selected">
      <FileText class="size-4 text-muted-foreground" />
      PDF
      <input type="file" accept={CHAT_DRAFT_PDF_ACCEPT} multiple class="hidden" onchange={attach} />
    </label>
  </div>

  {#if modes !== null}
    <h3 class="px-5 pt-2 pb-1.5 text-small font-medium text-muted-foreground">Permissions</h3>
    <div class="mx-5 grid grid-cols-3 gap-0.5 rounded-lg bg-hover p-0.5" role="radiogroup" aria-label="Permissions">
      {#each modes.declared as mode (mode.id)}
        {@const on = mode.id === modes.active}
        {@const Icon = modeIcon(mode)}
        <button
          type="button"
          role="radio"
          aria-checked={on}
          class={cn(
            'flex min-h-9 items-center justify-center gap-1.5 rounded-md text-ui font-medium',
            on ? 'bg-raised shadow-raised' : 'text-muted-foreground',
            on && mode.elevated === true && 'text-destructive',
          )}
          onclick={() => void host.writes.perform(host.writes.chooseMode(mode.id))}
        >
          {#if Icon}<Icon class="size-3.5" />{/if}
          {mode.label}
        </button>
      {/each}
    </div>
    {#if active !== null}
      <p class="px-5 pt-2 text-small text-muted-foreground">{active.description}</p>
    {/if}
  {/if}

  {#if delegation.allowed !== null}
    <div class="flex min-h-14 items-center gap-3 px-5 pt-3">
      <Users class="size-4 shrink-0 text-muted-foreground" />
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="text-body">Team</span>
        <span class="text-small text-muted-foreground">
          {delegation.allowed ? 'The agent may start helpers' : 'The agent works alone'}{delegation.origin === null
            ? ''
            : ` · set by ${delegation.origin}`}
        </span>
      </span>
      <SwitchControl
        label="Team"
        value={delegation.allowed}
        disabled={host.views.authority.busy}
        onwrite={(next) => void host.writes.applyDelegation(next ? 'on' : 'off')}
      />
    </div>
  {/if}
</Sheet>
