<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import Download from '@lucide/svelte/icons/download';
  import X from '@lucide/svelte/icons/x';
  import type { ChatAttachment } from './entries';
  import { useChatRendering } from './renderers';
  import { useChatStrings } from './strings';

  type Props = {
    image: ChatAttachment | null;
    onClose(): void;
  };

  let { image, onClose }: Props = $props();
  const strings = useChatStrings();
  const rendering = useChatRendering();

  let dialog: HTMLDialogElement | undefined = $state();

  const copyKey = $derived(image === null ? null : `viewer:${image.url}`);

  $effect(() => {
    const element = dialog;
    if (!element) return;
    if (image && !element.open) element.showModal();
    if (!image && element.open) element.close();
  });

  function copy(): void {
    if (image !== null && copyKey !== null) rendering.context.copyImage(copyKey, image);
  }

  function save(): void {
    if (image !== null) rendering.context.saveImage(image);
  }

  function copyKeys(event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== 'c' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const selection = document.getSelection();
    if (selection !== null && !selection.isCollapsed && dialog?.contains(selection.anchorNode)) return;
    event.preventDefault();
    copy();
  }

  function menu(event: MouseEvent): void {
    const open = rendering.navigation.imageMenu;
    if (open === undefined || image === null) return;
    event.preventDefault();
    open(image, { x: event.clientX, y: event.clientY }, dialog ?? null);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  class="m-0 h-full max-h-full w-full max-w-full items-center justify-center bg-transparent p-6 backdrop:bg-chat-scrim open:flex"
  onclose={onClose}
  onkeydown={copyKeys}
  onclick={(event) => {
    if (event.target === dialog) onClose();
  }}
>
  {#if image}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <img
      src={image.url}
      alt={image.filename ?? strings.attachment()}
      class="max-h-full max-w-full rounded-lg object-contain shadow-float"
      oncontextmenu={menu}
    />
    <div class="absolute right-4 top-4 flex gap-2">
      <button
        type="button"
        class="grid size-8 cursor-pointer place-items-center rounded-full bg-foreground text-background opacity-85 hover:opacity-100"
        aria-label={strings.copyImage()}
        title={strings.copyImage()}
        onclick={copy}
      >
        {#if copyKey !== null && rendering.context.copied(copyKey)}
          <Check class="size-4" />
        {:else}
          <Copy class="size-4" />
        {/if}
      </button>
      <button
        type="button"
        class="grid size-8 cursor-pointer place-items-center rounded-full bg-foreground text-background opacity-85 hover:opacity-100"
        aria-label={strings.saveImage()}
        title={strings.saveImage()}
        onclick={save}
      >
        <Download class="size-4" />
      </button>
      <button
        type="button"
        class="grid size-8 cursor-pointer place-items-center rounded-full bg-foreground text-background opacity-85 hover:opacity-100"
        aria-label={strings.close()}
        title={strings.close()}
        onclick={onClose}
      >
        <X class="size-4" />
      </button>
    </div>
  {/if}
</dialog>
