<script lang="ts" module>
  import type { ChatAttachment } from '@runlith/chat-ui/entries';

  export type ImageAim = { readonly x: number; readonly y: number; readonly image: ChatAttachment; readonly layer: HTMLElement | null };
</script>

<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import Download from '@lucide/svelte/icons/download';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';

  type Props = {
    aim: ImageAim | null;
    onCopy: (image: ChatAttachment) => void;
    onSave: (image: ChatAttachment) => void;
    onClose: () => void;
  };

  let { aim, onCopy, onSave, onClose }: Props = $props();

  let shown = $state.raw<ImageAim | null>(null);

  $effect.pre(() => {
    if (aim !== null) shown = aim;
  });

  function copy(): void {
    const target = aim;
    onClose();
    if (target !== null) onCopy(target.image);
  }

  function save(): void {
    const target = aim;
    onClose();
    if (target !== null) onSave(target.image);
  }
</script>

<DropdownMenu.Root bind:open={() => aim !== null, (next) => !next && onClose()}>
  <DropdownMenu.Content
    anchor={shown === null ? undefined : { x: shown.x, y: shown.y }}
    portal={shown?.layer ?? undefined}
    class="w-44"
    align="start"
    sideOffset={0}
    data-image-menu
  >
    <DropdownMenu.Item icon={Download} onSelect={save}>Save image…</DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item icon={Copy} onSelect={copy}>Copy image</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
